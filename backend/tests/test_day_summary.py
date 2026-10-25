import numpy as np
import pandas as pd
import pytest

from app.metrics import BIAS_NOTE, DATA_SCOPE_NOTE, align, coverage, day_summary
from tests.test_metrics import DAY, actual_frame, hours, selected


def test_coverage_is_inclusive_and_counts_valid_points_only() -> None:
    times = hours(DAY, 5)
    aligned = align(
        selected(times, [1.0] * 5), actual_frame(times[:4], [100.0, 200.0, 50.0, 400.0])
    )
    lower = pd.Series([100.0, 100.0, 100.0, None, 100.0])
    upper = pd.Series([200.0, 200.0, 200.0, 200.0, 200.0])

    result = coverage(aligned, lower, upper)

    # rows: on lower edge, on upper edge, below, no band, no actual
    assert result == {"inside": 2, "below": 1, "above": 0, "valid": 3, "coverage": 2 / 3}


def test_coverage_with_no_valid_points_is_null() -> None:
    aligned = align(selected(hours(DAY, 1), [1.0]), actual_frame([], []))

    assert coverage(aligned, pd.Series([0.0]), pd.Series([1.0]))["coverage"] is None


def day_of(
    n_hours: int = 24, *, drop_forecast: int | None = None, drop_half: str | None = None
) -> tuple[pd.DataFrame, pd.DataFrame]:
    times = hours(DAY, n_hours)
    forecast = [1000.0 + h for h in range(n_hours)]
    if drop_forecast is not None:
        forecast[drop_forecast] = None
    half = [f"{DAY}T{h:02d}:{m}:00Z" for h in range(n_hours) for m in ("00", "30")]
    acts = actual_frame(
        [t for t in half if t != drop_half], [900.0] * (len(half) - (drop_half is not None))
    )
    return align(selected(times, forecast), acts), acts


def test_day_summary_energy_skips_missing_hours_instead_of_zero_filling() -> None:
    day, acts = day_of(drop_forecast=5, drop_half=f"{DAY}T10:30:00Z")

    s = day_summary(day, acts)

    assert s["forecastHours"] == 23 and s["forecastMwh"] == sum(
        1000.0 + h for h in range(24) if h != 5
    )
    assert s["actualHours"] == 23 and s["actualMwh"] == 23 * 900.0
    assert s["energyComparison"]["hours"] == 22  # valid on both sides only
    assert s["energyComparison"]["actualMwh"] == 22 * 900.0


def test_day_summary_uses_the_last_half_hour_of_the_day() -> None:
    day, acts = day_of(drop_half=f"{DAY}T23:30:00Z")

    s = day_summary(day, acts)

    assert s["actualHours"] == 23  # 23:00 needs 23:00 and 23:30 to make an hourly average


def test_day_summary_keeps_bias_separate_and_handles_missing_band() -> None:
    day, acts = day_of(4)

    s = day_summary(day, acts)

    assert s["biasMw"] == pytest.approx(np.mean([100.0, 101.0, 102.0, 103.0]))
    assert s["coverage"] is None and s["coverageReason"] == "no band supplied"
    assert s["notes"] == {"scope": DATA_SCOPE_NOTE, "bias": BIAS_NOTE}
    assert "metered" in DATA_SCOPE_NOTE and "not known" in BIAS_NOTE


def test_day_summary_coverage_with_a_supplied_band() -> None:
    day, acts = day_of(4)
    band = pd.DataFrame(
        {"start_time": day["start_time"], "lower": [800.0, 950.0, 0.0, None], "upper": [1000.0] * 4}
    )

    s = day_summary(day, acts, band)

    assert s["coverage"] == {"inside": 2, "below": 1, "above": 0, "valid": 3, "coverage": 2 / 3}
    assert s["coverageReason"] is None


def test_day_summary_rejects_multiple_days_and_duplicate_band_rows() -> None:
    times = [f"{DAY}T00:00:00Z", "2026-01-16T00:00:00Z"]
    two_days = align(selected(times, [1.0, 1.0]), actual_frame(times, [1.0, 1.0]))
    with pytest.raises(ValueError, match="one UK delivery day"):
        day_summary(two_days, actual_frame(times, [1.0, 1.0]))

    day, acts = day_of(1)
    dup = pd.DataFrame(
        {"start_time": list(day["start_time"]) * 2, "lower": [0.0, 0.0], "upper": [1.0, 1.0]}
    )
    with pytest.raises(ValueError, match="one row per start_time"):
        day_summary(day, acts, dup)
