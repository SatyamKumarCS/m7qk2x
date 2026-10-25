"""Forecast-vs-actual metrics, breakdowns and the Decision-view day summary.

Methods are fixed by ADRs 0003 (point alignment), 0004 (sign and metric set), 0008 (horizon
buckets) and 0009 (coverage, energy, bias); docs/spec.md §4 has the definitions.

- error = forecast − actual, so a positive error is an over-forecast.
- Only *valid pairs* (forecast and actual both present) enter a metric; missing values are
  counted, never filled or treated as zero.
- The band used by `coverage`/`day_summary` is supplied by the caller (Planning band ticket).

Pure functions: no I/O, inputs are never mutated, outputs do not depend on input row order.
"""

from __future__ import annotations

import math
from datetime import date
from typing import Any, Literal

import numpy as np
import pandas as pd

from app import config

Metrics = dict[str, Any]

# Shown wherever bias or energy is reported (ADR 0009). The cause of the bias is unknown (Q-11).
DATA_SCOPE_NOTE = (
    "Operationally metered GB wind only (Elexon FUELHH WIND vs WINDFOR); about 82 % of GB wind "
    "per NESO, embedded generation excluded."
)
BIAS_NOTE = "Average forecast − actual. Its cause is not known; it is reported, not explained."

METRIC_KEYS = (
    "mae",
    "rmse",
    "bias",
    "medianAbs",
    "p90Abs",
    "p95Abs",
    "maxAbs",
    "nmae",
    "wape",
    "mapeAbove1GW",
    "r",
)


def align(selected: pd.DataFrame, actuals: pd.DataFrame) -> pd.DataFrame:
    """Point alignment (ADR 0003): join each forecast target to the actual starting at t.

    `selected` is output of app.selection; `actuals` has start_time and generation_mw (one row
    per half-hour). Adds actual_mw, error_mw (forecast − actual) and valid (both present).
    """
    if not actuals["start_time"].is_unique:
        raise ValueError("actuals must have one row per start_time")
    lookup = actuals.set_index("start_time")["generation_mw"]
    out = selected.copy()
    out["actual_mw"] = out["start_time"].map(lookup).astype("float64")
    out["error_mw"] = out["forecast_mw"] - out["actual_mw"]
    out["valid"] = out["forecast_mw"].notna() & out["actual_mw"].notna()
    return out


def in_delivery_days(frame: pd.DataFrame, first_day: date, last_day: date) -> pd.DataFrame:
    """Keep targets whose UK delivery day is in [first_day, last_day].

    Apply after selection (E-7), so runs published before the window still count.
    """
    uk_day = frame["start_time"].dt.tz_convert(config.TZ).dt.date
    return frame[(uk_day >= first_day) & (uk_day <= last_day)]


def _error_stats(errors: pd.Series) -> dict[str, float | None]:
    """MAE, RMSE, bias and P90 |error| over valid errors; None when there are none."""
    e = errors.dropna().to_numpy(dtype="float64")
    if e.size == 0:
        return {"mae": None, "rmse": None, "bias": None, "p90": None}
    a = np.abs(e)
    return {
        "mae": float(a.mean()),
        "rmse": float(math.sqrt((e**2).mean())),
        "bias": float(e.mean()),
        "p90": float(np.quantile(a, 0.9)),
    }


def compute_metrics(aligned: pd.DataFrame) -> Metrics:
    """Headline metric block (PRD §5.4, ADR 0004) over valid pairs.

    Units: MW, except nmae, wape and mapeAbove1GW (percent) and r (unitless). Every key is
    always present; values are None when they cannot be computed (n == 0, or too little
    variance for r). Counts: missingForecast / missingActual count rows lacking that value.
    """
    valid = _ordered(aligned[aligned["valid"]])
    f, a = valid["forecast_mw"].to_numpy("float64"), valid["actual_mw"].to_numpy("float64")
    e = f - a
    counts = {
        "n": int(len(valid)),
        "missingForecast": int(aligned["forecast_mw"].isna().sum()),
        "missingActual": int(aligned["actual_mw"].isna().sum()),
    }
    if e.size == 0:
        return {"metrics": dict.fromkeys(METRIC_KEYS), "counts": counts}
    abs_e = np.abs(e)
    mean_a, sum_a = a.mean(), a.sum()
    big = a >= config.MAPE_MIN_ACTUAL_MW
    metrics = {
        "mae": float(abs_e.mean()),
        "rmse": float(math.sqrt((e**2).mean())),
        "bias": float(e.mean()),
        "medianAbs": float(np.median(abs_e)),
        "p90Abs": float(np.quantile(abs_e, 0.9)),
        "p95Abs": float(np.quantile(abs_e, 0.95)),
        "maxAbs": float(abs_e.max()),
        "nmae": float(100 * abs_e.mean() / mean_a) if mean_a > 0 else None,
        "wape": float(100 * abs_e.sum() / sum_a) if sum_a > 0 else None,
        "mapeAbove1GW": float(100 * (abs_e[big] / a[big]).mean()) if big.any() else None,
        "r": _pearson(f, a),
    }
    return {"metrics": metrics, "counts": counts}


def _ordered(frame: pd.DataFrame) -> pd.DataFrame:
    """Sort by time so float reductions are bit-identical whatever the input row order."""
    keys = [k for k in ("start_time", "publish_time") if k in frame.columns]
    return frame.sort_values(keys, kind="stable")


def _pearson(x: np.ndarray, y: np.ndarray) -> float | None:
    if x.size < 2 or np.std(x) == 0 or np.std(y) == 0:
        return None
    return float(np.corrcoef(x, y)[0, 1])


def _group_row(label: str, errors: pd.Series, **extra: int) -> dict[str, Any]:
    n = int(errors.notna().sum())
    return {
        "group": label,
        "n": n,
        **_error_stats(errors),
        "lowSample": n < config.LOW_SAMPLE_N,
        **extra,
    }


def _level_labels() -> list[str]:
    """'<5 GW', '5–10 GW', ... from WIND_LEVEL_BINS_MW (finite edges in MW)."""
    edges = config.WIND_LEVEL_BINS_MW
    labels = []
    for lo, hi in zip(edges, edges[1:], strict=False):
        if math.isinf(lo):
            labels.append(f"<{hi / 1000:g} GW")
        elif math.isinf(hi):
            labels.append(f"≥{lo / 1000:g} GW")
        else:
            labels.append(f"{lo / 1000:g}–{hi / 1000:g} GW")
    return labels


def breakdown(aligned: pd.DataFrame, by: Literal["hour", "level", "day"]) -> list[dict[str, Any]]:
    """Error by UK hour (all 24), actual wind level (WIND_LEVEL_BINS_MW) or UK delivery day.

    Each group: {group, n, mae, rmse, bias, p90, lowSample} over valid pairs (PRD FR-2.7).
    Hour and level always return every group, empty ones with n = 0; day returns the days present.
    """
    valid = _ordered(aligned[aligned["valid"]])
    uk = valid["start_time"].dt.tz_convert(config.TZ)
    if by == "hour":
        return [_group_row(f"{h:02d}", valid.loc[uk.dt.hour == h, "error_mw"]) for h in range(24)]
    if by == "level":
        # PRD §5.5 groups by the *actual* level (notebook 01 §7 shows this exaggerates the gap at
        # low wind through regression to the mean). Left-closed bins: 5,000 MW is in "5–10 GW".
        levels = pd.cut(
            valid["actual_mw"], list(config.WIND_LEVEL_BINS_MW), right=False, labels=_level_labels()
        )
        return [
            _group_row(str(lab), valid.loc[levels == lab, "error_mw"])
            for lab in levels.cat.categories
        ]
    if by == "day":
        days = uk.dt.date
        return [
            _group_row(d.isoformat(), valid.loc[days == d, "error_mw"]) for d in sorted(set(days))
        ]
    raise ValueError(f"by must be 'hour', 'level' or 'day', got {by!r}")


def horizon_breakdown(
    forecasts: pd.DataFrame, actuals: pd.DataFrame, days: tuple[date, date] | None = None
) -> list[dict[str, Any]]:
    """Error by forecast horizon over **every run** (ADR 0008); independent of the cutoff.

    Buckets are half-open [a, b) from HORIZON_BINS_H. Each group adds `rows` (all forecast rows
    in the bucket) and `ukHoursPresent`, because long horizons only exist for some hours (Q-14).
    `days` optionally restricts targets to UK delivery days [first, last]. A horizon outside
    every bucket raises ValueError rather than being dropped silently.
    """
    runs = forecasts.rename(columns={"generation_mw": "forecast_mw"})
    if days is not None:
        runs = in_delivery_days(runs, *days)
    runs = _ordered(align(runs, actuals))
    edges = list(config.HORIZON_BINS_H)
    outside = ~runs["horizon_h"].between(edges[0], edges[-1], inclusive="left")
    if outside.any():
        raise ValueError(f"{int(outside.sum())} horizon(s) fall outside buckets {edges}")
    bucket = pd.cut(runs["horizon_h"], edges, right=False)
    uk_hour = runs["start_time"].dt.tz_convert(config.TZ).dt.hour
    errors = runs["error_mw"].where(runs["valid"])
    groups = []
    for interval in bucket.cat.categories:
        member = bucket == interval
        groups.append(
            _group_row(
                f"[{interval.left:g},{interval.right:g})",
                errors[member],
                rows=int(member.sum()),
                ukHoursPresent=int(uk_hour[member].nunique()),
            )
        )
    return groups


def coverage(frame: pd.DataFrame, lower: pd.Series, upper: pd.Series) -> dict[str, Any]:
    """Share of valid points with lower ≤ actual ≤ upper (inclusive; ADR 0006 / 0009).

    A point is valid when the actual and both band edges exist. Returns inside, below, above,
    valid and coverage (None when valid == 0). Works for any supplied band (80 % or 90 %).
    """
    actual = frame["actual_mw"]
    ok = actual.notna() & lower.notna() & upper.notna()
    a, lo, hi = actual[ok], lower[ok], upper[ok]
    inside, below = int(((a >= lo) & (a <= hi)).sum()), int((a < lo).sum())
    valid = int(ok.sum())
    return {
        "inside": inside,
        "below": below,
        "above": valid - inside - below,
        "valid": valid,
        "coverage": inside / valid if valid else None,
    }


def day_summary(
    day: pd.DataFrame, actuals: pd.DataFrame, band: pd.DataFrame | None = None
) -> dict[str, Any]:
    """Decision-view numbers for one UK delivery day (ADR 0009).

    `day` is aligned output for that day; `actuals` the half-hourly actuals; `band`, if
    given, has start_time, lower and upper. Energy uses valid hours only: forecast MWh = Σ
    hourly forecast × 1 h; actual MWh = Σ hourly-average actual × 1 h over hours with both
    half-hours. The comparison uses hours valid on both sides. Bias is reported separately
    from coverage and is never attributed to a cause.
    """
    uk_days = set(day["start_time"].dt.tz_convert(config.TZ).dt.date)
    if len(uk_days) > 1:
        raise ValueError(f"day_summary needs one UK delivery day, got {sorted(uk_days)}")
    day = _ordered(day)
    lookup = actuals.set_index("start_time")["generation_mw"]
    half = pd.Timedelta(minutes=30)
    hour_mean = (day["start_time"].map(lookup) + (day["start_time"] + half).map(lookup)) / 2
    has_f, has_a = day["forecast_mw"].notna(), hour_mean.notna()
    both = has_f & has_a
    comparison = None
    if both.any():
        f_mwh, a_mwh = float(day.loc[both, "forecast_mw"].sum()), float(hour_mean[both].sum())
        comparison = {
            "hours": int(both.sum()),
            "forecastMwh": f_mwh,
            "actualMwh": a_mwh,
            "errorPct": 100 * (f_mwh / a_mwh - 1) if a_mwh > 0 else None,
        }
    stats = _error_stats(day["error_mw"].where(day["valid"]))
    if band is None:
        band_coverage, reason = None, "no band supplied"
    else:
        if not band["start_time"].is_unique:
            raise ValueError("band must have one row per start_time")
        edges = band.set_index("start_time")
        lower = day["start_time"].map(edges["lower"])
        upper = day["start_time"].map(edges["upper"])
        band_coverage, reason = coverage(day, lower, upper), None
    return {
        "date": next(iter(uk_days)).isoformat() if uk_days else None,
        "points": int(len(day)),
        "validPairs": int(day["valid"].sum()),
        "maeMw": stats["mae"],
        "biasMw": stats["bias"],
        "forecastMwh": float(day.loc[has_f, "forecast_mw"].sum()) if has_f.any() else None,
        "forecastHours": int(has_f.sum()),
        "actualMwh": float(hour_mean[has_a].sum()) if has_a.any() else None,
        "actualHours": int(has_a.sum()),
        "energyComparison": comparison,
        "coverage": band_coverage,
        "coverageReason": reason,
        "notes": {"scope": DATA_SCOPE_NOTE, "bias": BIAS_NOTE},
    }
