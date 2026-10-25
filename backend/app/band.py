"""Planning band (ADR 0006): a global, asymmetric, empirical-quantile range for the actual.

- Residual: e = F − A on valid pairs only, where F is the decision-time forecast at the cutoff
  and A is the point-aligned actual (ADR 0003, `metrics.align`).
- Calibration window (global, per cutoff): every valid pair of every in-scope delivery day
  (config.DELIVERY_START..DELIVERY_END) at the selected cutoff. It is recomputed for each
  cutoff, but never per UI date range, and is not conditioned on hour or wind level.
- Quantiles: type 7 (linear interpolation between order statistics), from BAND_QUANTILES.
- Band: [max(0, F − q_hi), max(0, F − q_lo)]. It is a range for the *actual*, so it need not
  contain F. Containment is reported as a diagnostic and never enforced.
- Fewer than BAND_MIN_CALIBRATION_N valid residuals: no band; the reason is returned instead.

Coverage figures produced here are **observed** on the January 2026 backtest (in-sample, or
chronologically held out). They are not a guarantee for other periods.
Coverage counting, day summaries and alignment come from `app.metrics` and are not repeated.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from statistics import median
from typing import Any

import numpy as np
import pandas as pd

from app import config
from app.metrics import align, coverage, in_delivery_days
from app.selection import parse_cutoff_clock, select_forecasts, target_grid

Window = tuple[date, date]
WINDOW: Window = (config.DELIVERY_START, config.DELIVERY_END)


@dataclass(frozen=True)
class Calibration:
    """Quantiles for one cutoff and level. `reason` is set (and q_lo/q_hi are None) when the
    window has too few valid residuals to produce a band."""

    level: int
    n: int
    window: Window
    q_lo: float | None
    q_hi: float | None
    reason: str | None = None

    @property
    def ok(self) -> bool:
        return self.reason is None


def _probs(level: int) -> tuple[float, float]:
    if level not in config.BAND_QUANTILES:
        raise ValueError(f"level must be one of {sorted(config.BAND_QUANTILES)}, got {level}")
    return config.BAND_QUANTILES[level]


def _require_unique(frame: pd.DataFrame) -> None:
    if not frame["start_time"].is_unique:
        raise ValueError("expected one row per start_time (duplicate targets)")


def _calibration(errors: pd.Series, level: int, window: Window) -> Calibration:
    lo, hi = _probs(level)
    e = np.sort(errors.dropna().to_numpy(dtype="float64"))  # sorted: order-independent result
    if e.size < config.BAND_MIN_CALIBRATION_N:
        reason = (
            f"only {e.size} valid forecast/actual hours in the calibration window; "
            f"at least {config.BAND_MIN_CALIBRATION_N} are needed"
        )
        return Calibration(level, int(e.size), window, None, None, reason)
    q_lo, q_hi = np.quantile(e, [lo, hi], method="linear")
    return Calibration(level, int(e.size), window, float(q_lo), float(q_hi))


def calibrate(
    aligned: pd.DataFrame, level: int = config.BAND_DEFAULT_LEVEL, window: Window = WINDOW
) -> Calibration:
    """Global calibration: quantiles of valid residuals over every delivery day in `window`.

    `aligned` is `metrics.align` output for one cutoff (any extra days are ignored).
    """
    _require_unique(aligned)
    in_window = in_delivery_days(aligned, *window)
    return _calibration(in_window["error_mw"].where(in_window["valid"]), level, window)


def planning_band(day: pd.DataFrame, calibration: Calibration) -> pd.DataFrame | None:
    """Band for aligned rows (usually one delivery day), or None when the calibration failed.

    Columns: start_time, forecast_mw, lower, upper, actual_mw, contains_forecast. A target with
    no forecast keeps a row with null lower/upper; a missing actual still gets a band.
    """
    if not calibration.ok:
        return None
    _require_unique(day)
    rows = day.sort_values("start_time")
    forecast = rows["forecast_mw"]
    lower = (forecast - calibration.q_hi).clip(lower=0)
    upper = (forecast - calibration.q_lo).clip(lower=0)
    return pd.DataFrame(
        {
            "start_time": rows["start_time"],
            "forecast_mw": forecast,
            "lower": lower,
            "upper": upper,
            "actual_mw": rows["actual_mw"],
            "contains_forecast": forecast.notna() & (lower <= forecast) & (forecast <= upper),
        }
    ).reset_index(drop=True)


def contains_forecast(band: pd.DataFrame) -> dict[str, Any]:
    """Diagnostic only (ADR 0006): how many banded points contain their own forecast."""
    banded = band["forecast_mw"].notna()
    contained = int(band.loc[banded, "contains_forecast"].sum())
    points = int(banded.sum())
    return {"points": points, "contained": contained, "all": points > 0 and contained == points}


def in_sample_coverage(aligned: pd.DataFrame, calibration: Calibration) -> dict[str, Any] | None:
    """Observed coverage of the calibrated band over its own window (`metrics.coverage`)."""
    band = planning_band(in_delivery_days(aligned, *calibration.window), calibration)
    if band is None:
        return None
    return coverage(band, band["lower"], band["upper"])


def held_out_evaluation(
    aligned: pd.DataFrame,
    level: int = config.BAND_DEFAULT_LEVEL,
    window: Window = WINDOW,
    min_days: int = config.BAND_HELD_OUT_MIN_DAYS,
    lag_days: int = config.BAND_HELD_OUT_LAG_DAYS,
) -> dict[str, Any]:
    """Chronological, decision-time-honest check: day D is banded with quantiles from window
    days <= D − lag_days only (D−1 actuals are incomplete at the cutoff), once at least
    `min_days` such days exist. Reports pooled and daily observed coverage."""
    _require_unique(aligned)
    rows = in_delivery_days(aligned, *window)
    uk_day = rows["start_time"].dt.tz_convert(config.TZ).dt.date
    valid_day = uk_day[rows["valid"]]
    totals = {"valid": 0, "inside": 0, "below": 0}
    daily, positive_q_lo, skipped = [], 0, 0
    for d in sorted(set(uk_day)):
        last_known = d - timedelta(days=lag_days)
        if valid_day[valid_day <= last_known].nunique() < min_days:
            continue
        history = rows[uk_day <= last_known]
        cal = _calibration(history["error_mw"].where(history["valid"]), level, window)
        band = planning_band(rows[uk_day == d], cal)
        if band is None:
            skipped += 1
            continue
        positive_q_lo += cal.q_lo > 0
        cov = coverage(band, band["lower"], band["upper"])
        for key in totals:
            totals[key] += cov[key]
        if cov["valid"]:
            daily.append(cov["coverage"])
    valid = totals["valid"]
    return {
        "method": f"rolling origin: days <= D-{lag_days}, >= {min_days} days of history",
        "level": level,
        "evalDays": len(daily),
        "skippedDays": skipped,
        **totals,
        "coverage": totals["inside"] / valid if valid else None,
        "belowShare": totals["below"] / valid if valid else None,
        "dailyCoverageMin": min(daily) if daily else None,
        "dailyCoverageMedian": median(daily) if daily else None,
        "daysBelowHalf": sum(c < 0.5 for c in daily),
        "calibrationsWithPositiveQLo": int(positive_q_lo),
    }


def cutoff_calibrations(
    forecasts: pd.DataFrame, actuals: pd.DataFrame, cutoffs: list[str] | None = None
) -> dict[str, dict[int, dict[str, Any]]]:
    """Calibrate every level for every cutoff (default: all CUTOFF_PRESETS), with observed
    in-sample and held-out coverage. Plain dicts, ready for the API to serve or cache."""
    grid = target_grid(*WINDOW)
    out: dict[str, dict[int, dict[str, Any]]] = {}
    for clock in cutoffs or sorted(set(config.CUTOFF_PRESETS.values())):
        aligned = align(select_forecasts(forecasts, grid, parse_cutoff_clock(clock)), actuals)
        out[clock] = {}
        for level in sorted(config.BAND_QUANTILES):
            cal = calibrate(aligned, level)
            out[clock][level] = {
                "calibration": cal,
                "inSample": in_sample_coverage(aligned, cal),
                "heldOut": held_out_evaluation(aligned, level),
            }
    return out
