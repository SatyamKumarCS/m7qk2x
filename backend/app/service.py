"""Response builders for the read-only API (docs/spec.md §5).

Each builder is a cached pure function of its parameters (FR-2.10) that composes the existing
engines: app.selection (decision-time forecast), app.metrics (errors, breakdowns, day summary)
and app.band (planning band). This module only shapes and rounds (MW to 1 dp, FR-2.1); it adds
no statistics of its own.
"""

from __future__ import annotations

import logging
import math
from datetime import date, timedelta
from functools import lru_cache
from typing import Any

import pandas as pd

from app import about, config
from app.band import (
    calibrate,
    contains_forecast,
    held_out_evaluation,
    in_sample_coverage,
    planning_band,
)
from app.data_store import get_store
from app.metrics import (
    align,
    breakdown,
    compute_metrics,
    day_summary,
    horizon_breakdown,
    in_delivery_days,
)
from app.selection import parse_cutoff_clock, select_forecasts, target_grid

log = logging.getLogger("api")
Json = dict[str, Any]
CACHE = config.CACHE_SIZE


class InvariantError(RuntimeError):
    """A selected forecast was published after its cutoff (must never happen; ADR 0002)."""


def r(value: float | None, digits: int = 1) -> float | None:
    """Round for JSON; None, NaN and NaT become null."""
    if value is None or pd.isna(value):
        return None
    return round(float(value), digits)


def iso(ts: pd.Timestamp | None) -> str | None:
    return None if ts is None or pd.isna(ts) else pd.Timestamp(ts).strftime("%Y-%m-%dT%H:%M:%SZ")


@lru_cache(maxsize=CACHE)
def aligned_for(cutoff: str) -> pd.DataFrame:
    """Decision-time forecast for every in-scope target at `cutoff`, joined to actuals.

    Shared by all builders and treated as read-only.
    """
    store = get_store()
    grid = target_grid(config.DELIVERY_START, config.DELIVERY_END)
    return align(select_forecasts(store.forecasts, grid, parse_cutoff_clock(cutoff)), store.actuals)


def _checked(frame: pd.DataFrame) -> pd.DataFrame:
    """Enforce publish_time <= cutoff for every selected forecast before it leaves the API."""
    late = frame["forecast_mw"].notna() & (frame["publish_time"] > frame["limit_time"])
    if late.any():
        log.error("invariant breach: %d forecast(s) published after their cutoff", int(late.sum()))
        raise InvariantError("A forecast published after its cutoff was selected.")
    return frame


def _days(start: date, end: date, cutoff: str) -> pd.DataFrame:
    return _checked(in_delivery_days(aligned_for(cutoff), start, end))


def _counts(aligned: pd.DataFrame) -> Json:
    return compute_metrics(aligned)["counts"]


@lru_cache(maxsize=CACHE)
def timeseries(start: date, end: date, cutoff: str) -> Json:
    """One point per half-hour; forecast fields only on hourly forecast targets (ADR 0003)."""
    store = get_store()
    aligned = _days(start, end, cutoff)
    first = pd.Timestamp(start).tz_localize(config.TZ)
    stop = pd.Timestamp(end + timedelta(days=1)).tz_localize(config.TZ)
    halves = (
        pd.date_range(first, stop, freq="30min", inclusive="left").tz_convert("UTC").as_unit("ns")
    )
    frame = pd.DataFrame({"start_time": halves}).merge(
        aligned[["start_time", "forecast_mw", "publish_time", "horizon_h", "error_mw"]],
        on="start_time",
        how="left",
        indicator=True,
    )
    frame["evaluated"] = frame.pop("_merge") == "both"  # this half-hour is a forecast target
    frame["actual"] = frame["start_time"].map(
        store.actuals.set_index("start_time")["generation_mw"]
    )
    points = [
        {
            "startTime": iso(row.start_time),
            "actual": r(row.actual),
            "forecast": r(row.forecast_mw),
            "publishTime": iso(row.publish_time),
            "horizonHours": r(row.horizon_h),
            "error": r(row.error_mw),
            "evaluated": bool(row.evaluated),
        }
        for row in frame.itertuples(index=False)
    ]
    return {**_echo(start, end, cutoff), "points": points, "counts": _counts(aligned)}


def _echo(start: date, end: date, cutoff: str | None) -> Json:
    return {
        "start": start.isoformat(),
        "end": end.isoformat(),
        "cutoff": cutoff,
        "timezone": config.TZ,
    }


@lru_cache(maxsize=CACHE)
def metrics(start: date, end: date, cutoff: str) -> Json:
    result = compute_metrics(_days(start, end, cutoff))
    m = result["metrics"]
    percent = ("nmae", "wape", "mapeAbove1GW")
    rounded = {k: r(v, 2) if k in percent else r(v, 4) if k == "r" else r(v) for k, v in m.items()}
    return {**_echo(start, end, cutoff), "metrics": rounded, "counts": result["counts"]}


def _group(g: Json) -> Json:
    return {
        "group": g["group"],
        "n": g["n"],
        "mae": r(g["mae"]),
        "rmse": r(g["rmse"]),
        "bias": r(g["bias"]),
        "p90": r(g["p90"]),
        "lowSample": g["lowSample"],
    }


@lru_cache(maxsize=CACHE)
def breakdowns(by: str, start: date, end: date, cutoff: str) -> Json:
    """Error grouped by horizon (every run, cutoff ignored; ADR 0008), hour, level or day."""
    if by == "horizon":
        store = get_store()
        groups = horizon_breakdown(store.forecasts, store.actuals, days=(start, end))
        partial = [g for g in groups if g["rows"] and g["ukHoursPresent"] < 24]
        note = (
            "; ".join(
                f"{g['group']} h covers only {g['ukHoursPresent']} of 24 UK hours" for g in partial
            )
            + " (forecast runs end at 21:00 UTC two days after publication),"
            + " so compare it with care."
            if partial
            else None
        )
        return {
            **_echo(start, end, None),
            "by": by,
            "groups": [_group(g) for g in groups],
            "note": note,
        }
    groups = breakdown(_days(start, end, cutoff), by)  # type: ignore[arg-type]
    return {
        **_echo(start, end, cutoff),
        "by": by,
        "groups": [_group(g) for g in groups],
        "note": None,
    }


@lru_cache(maxsize=CACHE)
def _calibration(cutoff: str, level: int) -> Json:
    aligned = aligned_for(cutoff)
    cal = calibrate(aligned, level)
    in_sample = in_sample_coverage(aligned, cal) if cal.ok else None
    held_out = held_out_evaluation(aligned, level) if cal.ok else None
    return {
        "cal": cal,
        "block": {
            "start": cal.window[0].isoformat(),
            "end": cal.window[1].isoformat(),
            "n": cal.n,
            "method": "empirical-type7-global",
            "inSampleCoverage": r(in_sample["coverage"], 4) if in_sample else None,
            "heldOutCoverage": r(held_out["coverage"], 4) if held_out else None,
        },
    }


def _summary(summary: Json) -> Json:
    out = {
        **summary,
        "maeMw": r(summary["maeMw"]),
        "biasMw": r(summary["biasMw"]),
        "forecastMwh": r(summary["forecastMwh"]),
        "actualMwh": r(summary["actualMwh"]),
    }
    if summary["energyComparison"]:
        e = summary["energyComparison"]
        out["energyComparison"] = {
            **e,
            "forecastMwh": r(e["forecastMwh"]),
            "actualMwh": r(e["actualMwh"]),
            "errorPct": r(e["errorPct"], 2),
        }
    if summary["coverage"]:
        out["coverage"] = {**summary["coverage"], "coverage": r(summary["coverage"]["coverage"], 4)}
    return out


@lru_cache(maxsize=CACHE)
def band_day(day: date, cutoff: str, level: int) -> Json:
    """Planning band for one delivery day (ADR 0006) with the ADR 0009 day summary."""
    store = get_store()
    calibration = _calibration(cutoff, level)
    cal = calibration["cal"]
    rows = _days(day, day, cutoff)
    band = planning_band(rows, cal)
    summary = _summary(day_summary(rows, store.actuals, band))
    if band is None:
        summary["coverageReason"] = cal.reason
        source = rows.assign(lower=math.nan, upper=math.nan)
    else:
        source = band
    points = []
    for row in source.sort_values("start_time").itertuples(index=False):
        has_band = not (pd.isna(row.lower) or pd.isna(row.upper))
        inside = (
            None
            if pd.isna(row.actual_mw) or not has_band
            else bool(row.lower <= row.actual_mw <= row.upper)
        )
        points.append(
            {
                "startTime": iso(row.start_time),
                "forecast": r(row.forecast_mw),
                "lower": r(row.lower),
                "upper": r(row.upper),
                "actual": r(row.actual_mw),
                "inside": inside,
            }
        )
    return {
        "date": day.isoformat(),
        "cutoff": cutoff,
        "level": level,
        "timezone": config.TZ,
        "qLo": r(cal.q_lo),
        "qHi": r(cal.q_hi),
        "calibration": calibration["block"],
        "points": points,
        "summary": {
            **summary,
            "containsForecast": contains_forecast(band) if band is not None else None,
        },
        "reason": cal.reason,
    }


def meta() -> Json:
    quality = get_store().quality
    clocks = quality["forecasts"]["publishClockTimes"]
    regular = max(clocks.values(), default=0) / 2  # drop one-off late runs (e.g. 12:25 on 15 Jan)
    return {
        "scope": {
            "deliveryStart": config.DELIVERY_START.isoformat(),
            "deliveryEnd": config.DELIVERY_END.isoformat(),
        },
        "defaultCutoff": config.DEFAULT_CUTOFF,
        "cutoffPresets": [{"label": k, "value": v} for k, v in config.CUTOFF_PRESETS.items()],
        "publishSchedule": sorted(t for t, n in clocks.items() if n >= regular),
        "forecastResolutionMinutes": quality["forecasts"]["resolutionMinutes"],
        "assumptions": about.ASSUMPTIONS,
        "quality": quality,
        "sources": about.SOURCES,
        "version": config.API_VERSION,
    }


def reset_caches() -> None:
    """Drop every cached result (used by tests when the data source changes)."""
    for fn in (aligned_for, timeseries, metrics, breakdowns, _calibration, band_day):
        fn.cache_clear()
