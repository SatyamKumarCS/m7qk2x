from datetime import date, timedelta

import numpy as np
import pandas as pd
import pytest

from app import config
from app.band import (
    Calibration,
    calibrate,
    contains_forecast,
    held_out_evaluation,
    in_sample_coverage,
    planning_band,
)
from app.metrics import align, coverage, day_summary

FIRST = config.DELIVERY_START  # 2 Jan 2026, inside the calibration window


def aligned_from(
    errors: list[float | None], first: date = FIRST, forecast: float = 1000.0
) -> pd.DataFrame:
    """Hourly targets from `first` with a constant forecast; actual = forecast − error.

    An error of None means the actual is missing.
    """
    start = pd.Timestamp(first, tz="UTC")
    times = pd.Series(
        [start + pd.Timedelta(hours=h) for h in range(len(errors))], dtype="datetime64[ns, UTC]"
    )
    sel = pd.DataFrame({"start_time": times, "forecast_mw": forecast})
    acts = pd.DataFrame(
        {
            "start_time": times[[e is not None for e in errors]],
            "generation_mw": [forecast - e for e in errors if e is not None],
        }
    )
    return align(sel, acts)


def cal_of(q_lo: float, q_hi: float) -> Calibration:
    return Calibration(80, 200, (FIRST, FIRST), q_lo, q_hi)


# --- band formula and quantiles (replaces PRD §11.2 test 5; ADR 0006) --------------------


def test_band_formula_uses_type7_quantiles() -> None:
    cal = calibrate(aligned_from([float(e) for e in range(200)]))

    assert cal.ok and cal.n == 200
    assert cal.q_lo == pytest.approx(np.quantile(np.arange(200), 0.10, method="linear"))  # 19.9
    assert cal.q_hi == pytest.approx(np.quantile(np.arange(200), 0.90, method="linear"))  # 179.1
    band = planning_band(aligned_from([0.0]), cal)
    assert band["lower"].tolist() == [pytest.approx(1000 - 179.1)]
    assert band["upper"].tolist() == [pytest.approx(1000 - 19.9)]


@pytest.mark.parametrize("forecast", [0.0, 50.0, 179.1, 500.0, 25_000.0])
def test_lower_never_below_zero_and_lower_le_upper(forecast: float) -> None:
    band = planning_band(aligned_from([0.0], forecast=forecast), cal_of(-300.0, 180.0))

    assert (band["lower"] >= 0).all() and (band["upper"] >= 0).all()
    assert (band["lower"] <= band["upper"]).all()


def test_band_lies_wholly_below_forecast_when_q_lo_is_positive() -> None:
    # Pinned behaviour (ADR 0006): a forecast that is always too high gives a correct band below F.
    cal = calibrate(aligned_from(list(np.linspace(500, 3000, 200))))
    band = planning_band(aligned_from([0.0], forecast=10_000.0), cal)

    assert cal.q_lo > 0
    assert band["upper"].iloc[0] < 10_000.0
    assert contains_forecast(band) == {"points": 1, "contained": 0, "all": False}


def test_containment_is_a_diagnostic_not_a_constraint() -> None:
    mixed = pd.concat(
        [
            planning_band(aligned_from([0.0]), cal_of(-100.0, 100.0)),
            planning_band(aligned_from([0.0], date(2026, 1, 3)), cal_of(50.0, 100.0)),
        ]
    )

    assert contains_forecast(mixed) == {"points": 2, "contained": 1, "all": False}


def test_levels_come_from_config(monkeypatch: pytest.MonkeyPatch) -> None:
    errors = aligned_from([float(e) for e in range(200)])
    monkeypatch.setitem(config.BAND_QUANTILES, 80, (0.25, 0.75))

    cal = calibrate(errors, 80)

    assert cal.q_lo == pytest.approx(np.quantile(np.arange(200), 0.25))
    with pytest.raises(ValueError, match="level must be one of"):
        calibrate(errors, 70)


# --- minimum sample, missing data, empty, duplicates, window -----------------------------


def test_fewer_than_minimum_valid_residuals_gives_no_band_with_reason() -> None:
    short = calibrate(aligned_from([1.0] * 99))
    exact = calibrate(aligned_from([1.0] * 100))

    assert not short.ok and short.q_lo is None and "at least 100" in short.reason
    assert planning_band(aligned_from([0.0]), short) is None
    assert in_sample_coverage(aligned_from([1.0] * 99), short) is None
    assert exact.ok and exact.n == 100


def test_invalid_pairs_do_not_count_towards_the_minimum() -> None:
    cal = calibrate(aligned_from([1.0] * 90 + [None] * 30))

    assert cal.n == 90 and not cal.ok


def test_empty_input_gives_no_band() -> None:
    cal = calibrate(aligned_from([]))

    assert cal.n == 0 and not cal.ok and "only 0" in cal.reason


def test_missing_forecast_gets_null_band_and_missing_actual_is_still_banded() -> None:
    day = aligned_from([0.0, None])
    day.loc[0, ["forecast_mw", "error_mw", "valid"]] = [np.nan, np.nan, False]

    band = planning_band(day, cal_of(-100.0, 100.0))

    assert band["lower"].isna().tolist() == [True, False]
    assert band["actual_mw"].isna().tolist() == [False, True]
    assert coverage(band, band["lower"], band["upper"])["valid"] == 0


def test_duplicate_targets_are_rejected() -> None:
    dup = pd.concat([aligned_from([1.0] * 100), aligned_from([1.0])])

    with pytest.raises(ValueError, match="duplicate targets"):
        calibrate(dup)
    with pytest.raises(ValueError, match="duplicate targets"):
        planning_band(dup, cal_of(-1.0, 1.0))


def test_calibration_window_ignores_days_outside_scope() -> None:
    before = aligned_from([1e6] * 48, FIRST - timedelta(days=2))  # 31 Dec – 1 Jan
    inside = aligned_from([float(e) for e in range(200)])

    cal = calibrate(pd.concat([before, inside], ignore_index=True))

    assert cal.n == 200 and cal.window == (config.DELIVERY_START, config.DELIVERY_END)
    assert cal.q_hi == pytest.approx(179.1)


def test_calibration_and_band_are_order_independent() -> None:
    errors = aligned_from([float((37 * h) % 211) for h in range(200)])
    shuffled = errors.sample(frac=1, random_state=11)

    assert calibrate(errors) == calibrate(shuffled)
    pd.testing.assert_frame_equal(
        planning_band(errors, cal_of(-5.0, 9.0)), planning_band(shuffled, cal_of(-5.0, 9.0))
    )


# --- reuse of coverage / day_summary ------------------------------------------------------


def test_band_fed_to_coverage_and_day_summary_hand_example() -> None:
    day = aligned_from([0.0, 150.0, -150.0, None])  # actuals 1000, 850, 1150, missing
    band = planning_band(day, cal_of(-100.0, 100.0))  # [900, 1100] for every hour
    half_hours = pd.DataFrame(
        {
            "start_time": [
                t + pd.Timedelta(minutes=m) for t in day["start_time"][:3] for m in (0, 30)
            ],
            "generation_mw": [1000.0, 1000.0, 850.0, 850.0, 1150.0, 1150.0],
        }
    )

    direct = coverage(band, band["lower"], band["upper"])
    summary = day_summary(day, half_hours, band)

    assert direct == {"inside": 1, "below": 1, "above": 1, "valid": 3, "coverage": 1 / 3}
    assert summary["coverage"] == direct


# --- chronological held-out evaluation ----------------------------------------------------


def test_held_out_never_uses_the_previous_day() -> None:
    # Days 1-5: errors 0..119; day 6 (= D-1 for day 7): huge errors; day 7: error 115 (> q90 of
    # days 1-5). Without leakage day 7 falls below its band (coverage 0); with day 6 it would pass.
    errors = [float(e) for e in range(120)] + [1e6] * 24 + [115.0] * 24
    aligned = aligned_from(errors)
    window = (FIRST, FIRST + timedelta(days=6))

    result = held_out_evaluation(aligned, 80, window=window, min_days=5, lag_days=2)

    assert result["evalDays"] == 1
    assert result["valid"] == 24 and result["inside"] == 0 and result["belowShare"] == 1.0


def test_held_out_skips_days_without_enough_history() -> None:
    result = held_out_evaluation(
        aligned_from([1.0] * 24 * 3), 80, window=(FIRST, FIRST + timedelta(days=2))
    )

    assert result["evalDays"] == 0 and result["coverage"] is None
