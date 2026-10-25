"""Forecast selection: which WINDFOR value the buyer actually had at decision time (ADR 0002).

For a target time t whose UK delivery day is D, cutoff(t) is D-1 at the cutoff clock, UK time.
The selected forecast is the row with the latest publish_time <= cutoff(t), inclusive. If no
row qualifies the forecast is null. There is never a fallback to a later run.

All inputs and outputs are UTC; only the delivery day and cutoff are reasoned about in
Europe/London (ADR 0005). Pure functions: no I/O, inputs are never mutated.
"""

from __future__ import annotations

import re
from datetime import date, time, timedelta

import numpy as np
import pandas as pd

from app import config

FORECAST_COLUMNS = ("start_time", "publish_time", "generation_mw")
OUTPUT_COLUMNS = ["start_time", "forecast_mw", "publish_time", "horizon_h", "limit_time"]
_CLOCK = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")


def parse_cutoff_clock(value: str) -> time:
    """Parse an "HH:MM" UK cutoff clock (24 h, zero-padded). Raises ValueError otherwise."""
    match = _CLOCK.match(value)
    if not match:
        raise ValueError(f"cutoff must be HH:MM between 00:00 and 23:59, got {value!r}")
    return time(int(match[1]), int(match[2]))


def target_grid(first_day: date, last_day: date) -> pd.DatetimeIndex:
    """Expected forecast target times (UTC) for UK delivery days first_day..last_day inclusive.

    Built in UK time, so a clock-change day has 23 or 25 hourly targets (A-13).
    """
    start = pd.Timestamp(first_day).tz_localize(config.TZ)
    end = pd.Timestamp(last_day + timedelta(days=1)).tz_localize(config.TZ)
    step = pd.Timedelta(minutes=config.FORECAST_RESOLUTION_MIN)
    grid = pd.date_range(start, end, freq=step, inclusive="left")
    return grid.tz_convert("UTC").as_unit("ns")


def cutoff_for(start_time: pd.Series, cutoff_clock: time) -> pd.Series:
    """Cutoff instant (UTC) for each target: the cutoff clock on the UK day before delivery.

    A cutoff that falls in a clock change resolves to its earliest instant, so the rule can
    only ever get stricter: an ambiguous autumn time takes the BST reading, and a nonexistent
    spring time shifts back to just before the gap.
    """
    _require_utc(start_time, "start_time")
    local_wall = start_time.dt.tz_convert(config.TZ).dt.tz_localize(None)
    decision_day = local_wall.dt.normalize() - pd.Timedelta(days=1)
    clock = pd.Timedelta(hours=cutoff_clock.hour, minutes=cutoff_clock.minute)
    cutoff_local = (decision_day + clock).dt.tz_localize(
        config.TZ,
        ambiguous=np.ones(len(start_time), dtype=bool),
        nonexistent="shift_backward",
    )
    return cutoff_local.dt.tz_convert("UTC").dt.as_unit("ns")


def select_forecasts(
    forecasts: pd.DataFrame, targets: pd.DatetimeIndex, cutoff_clock: time
) -> pd.DataFrame:
    """Decision-time forecast for each target at the given UK cutoff clock (ADR 0002).

    Returns one row per unique target, sorted by start_time, with columns start_time,
    forecast_mw, publish_time, horizon_h and limit_time (the cutoff used). Targets with no
    run published at or before their cutoff keep a row with null forecast_mw, publish_time
    and horizon_h (E-1).
    """
    times = _unique_targets(targets)
    return _latest_at_or_before(forecasts, times, cutoff_for(times, cutoff_clock))


def select_by_min_horizon(
    forecasts: pd.DataFrame, targets: pd.DatetimeIndex, min_horizon_h: float
) -> pd.DataFrame:
    """Latest forecast published at least min_horizon_h hours before each target.

    Same output as select_forecasts, with limit_time = start_time - min_horizon_h. Used for
    the horizon analysis (PRD §5.2, §5.5).
    """
    if not min_horizon_h >= 0:
        raise ValueError(f"min_horizon_h must be >= 0, got {min_horizon_h}")
    times = _unique_targets(targets)
    return _latest_at_or_before(forecasts, times, times - pd.Timedelta(hours=min_horizon_h))


def _latest_at_or_before(
    forecasts: pd.DataFrame, times: pd.Series, limits: pd.Series
) -> pd.DataFrame:
    """For each target, the row with the greatest publish_time <= its limit (inclusive).

    Deterministic: rows tied on (start_time, publish_time) resolve to the last one in input
    order, matching the dataset build's "keep the last row as returned" rule (E-3).
    """
    missing = [c for c in FORECAST_COLUMNS if c not in forecasts.columns]
    if missing:
        raise ValueError(f"forecasts is missing column(s) {', '.join(missing)}")
    _require_utc(forecasts["start_time"], "forecasts.start_time")
    _require_utc(forecasts["publish_time"], "forecasts.publish_time")

    runs = pd.DataFrame(
        {
            "start_time": _as_utc_ns(forecasts["start_time"]),
            "publish_time": _as_utc_ns(forecasts["publish_time"]),
            "generation_mw": forecasts["generation_mw"].to_numpy(),
            "row": np.arange(len(forecasts)),  # input order, the final tie-breaker
        }
    )
    frame = pd.DataFrame({"start_time": times, "limit_time": limits})
    runs = runs.merge(frame, on="start_time", how="inner")
    eligible = runs[runs["publish_time"] <= runs["limit_time"]]
    latest = eligible.sort_values(["start_time", "publish_time", "row"]).drop_duplicates(
        "start_time", keep="last"
    )

    chosen = latest[["start_time", "publish_time", "generation_mw"]]
    out = frame.merge(chosen, on="start_time", how="left")
    out = out.rename(columns={"generation_mw": "forecast_mw"})
    out["forecast_mw"] = out["forecast_mw"].astype("float64")
    out["horizon_h"] = (out["start_time"] - out["publish_time"]) / pd.Timedelta(hours=1)
    return out[OUTPUT_COLUMNS]


def _unique_targets(targets: pd.DatetimeIndex) -> pd.Series:
    times = pd.Series(pd.DatetimeIndex(targets).unique().sort_values(), name="start_time")
    _require_utc(times, "targets")
    return _as_utc_ns(times)


def _as_utc_ns(values: pd.Series) -> pd.Series:
    return values.dt.tz_convert("UTC").dt.as_unit("ns").reset_index(drop=True)


def _require_utc(values: pd.Series, name: str) -> None:
    if not isinstance(values.dtype, pd.DatetimeTZDtype):
        raise ValueError(f"{name} must be timezone-aware UTC timestamps, got {values.dtype}")
