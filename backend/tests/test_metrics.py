import math
from datetime import date

import numpy as np
import pandas as pd
import pytest

from app.metrics import (
    METRIC_KEYS,
    align,
    breakdown,
    compute_metrics,
    day_summary,
    horizon_breakdown,
    in_delivery_days,
)


def utc(values: list[str]) -> pd.Series:
    return pd.Series(pd.to_datetime(values, utc=True, format="ISO8601"))


def selected(times: list[str], forecast: list[float | None]) -> pd.DataFrame:
    """A selection-shaped frame (the columns app.selection returns)."""
    start = utc(times)
    publish = start - pd.Timedelta(hours=20)
    return pd.DataFrame(
        {
            "start_time": start,
            "forecast_mw": pd.Series(forecast, dtype="float64"),
            "publish_time": publish,
            "horizon_h": 20.0,
            "limit_time": publish,
        }
    )


def actual_frame(times: list[str], values: list[float]) -> pd.DataFrame:
    return pd.DataFrame({"start_time": utc(times), "generation_mw": values})


def hours(day: str, n: int = 4) -> list[str]:
    return [f"{day}T{h:02d}:00:00Z" for h in range(n)]


DAY = "2026-01-15"
F4, A4 = [100.0, 200.0, 300.0, 400.0], [110.0, 190.0, 330.0, 380.0]  # e = -10, 10, -30, 20


def aligned4() -> pd.DataFrame:
    return align(selected(hours(DAY), F4), actual_frame(hours(DAY), A4))


# --- PRD §11.2 tests 1, 2, 3, 4, 6 (test 5 belongs to the Planning band ticket) ---------


def test_1_mae_rmse_bias_match_hand_calculation() -> None:
    m = compute_metrics(aligned4())["metrics"]

    assert m["mae"] == pytest.approx(17.5)
    assert m["rmse"] == pytest.approx(math.sqrt(375))
    assert m["bias"] == pytest.approx(-2.5)


def test_2_rows_with_missing_actual_are_excluded_and_counted() -> None:
    times = hours(DAY)
    aligned = align(selected(times, F4), actual_frame(times[:3], A4[:3]))

    result = compute_metrics(aligned)

    assert result["counts"] == {"n": 3, "missingForecast": 0, "missingActual": 1}
    assert result["metrics"]["mae"] == pytest.approx((10 + 10 + 30) / 3)


def test_3_empty_input_returns_zero_n_and_null_metrics() -> None:
    empty = align(selected([], []), actual_frame([], []))

    result = compute_metrics(empty)

    assert result["counts"] == {"n": 0, "missingForecast": 0, "missingActual": 0}
    assert result["metrics"] == dict.fromkeys(METRIC_KEYS)
    assert all(g["n"] == 0 and g["mae"] is None for g in breakdown(empty, "hour"))
    assert breakdown(empty, "day") == []


def test_4_groups_with_fewer_than_30_points_are_low_sample() -> None:
    groups = {g["group"]: g for g in breakdown(aligned4(), "hour")}

    assert groups["00"]["n"] == 1 and groups["00"]["lowSample"] is True
    assert groups["05"]["n"] == 0 and groups["05"]["lowSample"] is True


def test_6_forecast_above_actual_gives_positive_error() -> None:
    aligned = align(selected(hours(DAY, 1), [500.0]), actual_frame(hours(DAY, 1), [400.0]))

    assert aligned["error_mw"].tolist() == [100.0]
    assert compute_metrics(aligned)["metrics"]["bias"] == 100.0


# --- full metric set, MAPE threshold, correlation ----------------------------------------


def test_full_metric_set_matches_hand_calculation() -> None:
    m = compute_metrics(aligned4())["metrics"]
    abs_e = np.array([10.0, 10.0, 30.0, 20.0])

    assert m["medianAbs"] == pytest.approx(15.0)
    assert m["p90Abs"] == pytest.approx(np.quantile(abs_e, 0.9))  # type-7 linear
    assert m["p95Abs"] == pytest.approx(np.quantile(abs_e, 0.95))
    assert m["maxAbs"] == 30.0
    assert m["nmae"] == pytest.approx(100 * 17.5 / np.mean(A4))
    assert m["wape"] == pytest.approx(100 * 70 / sum(A4))
    assert m["r"] == pytest.approx(np.corrcoef(F4, A4)[0, 1])


def test_mape_uses_only_actuals_at_or_above_one_gw() -> None:
    times = hours(DAY, 3)
    aligned = align(
        selected(times, [1100.0, 50.0, 900.0]), actual_frame(times, [1000.0, 10.0, 999.0])
    )

    m = compute_metrics(aligned)["metrics"]

    assert m["mapeAbove1GW"] == pytest.approx(10.0)  # only the 1,000 MW row (boundary included)
    below = align(selected(times[1:], [50.0, 900.0]), actual_frame(times[1:], [10.0, 999.0]))
    assert compute_metrics(below)["metrics"]["mapeAbove1GW"] is None


def test_correlation_is_null_when_a_series_is_constant() -> None:
    times = hours(DAY, 3)
    aligned = align(selected(times, [100.0, 100.0, 100.0]), actual_frame(times, [1.0, 2.0, 3.0]))

    assert compute_metrics(aligned)["metrics"]["r"] is None


# --- missing data, alignment, delivery-day filter ---------------------------------------


def test_missing_forecast_is_counted_and_never_filled() -> None:
    times = hours(DAY)
    aligned = align(selected(times, [100.0, None, 300.0, 400.0]), actual_frame(times, A4))

    result = compute_metrics(aligned)

    assert result["counts"] == {"n": 3, "missingForecast": 1, "missingActual": 0}
    assert aligned["error_mw"].isna().tolist() == [False, True, False, False]
    assert result["metrics"]["mae"] == pytest.approx((10 + 30 + 20) / 3)


def test_align_uses_the_half_hour_starting_at_the_forecast_time() -> None:
    times = hours(DAY, 1)
    half_hours = actual_frame([times[0], f"{DAY}T00:30:00Z"], [1000.0, 9999.0])

    aligned = align(selected(times, [1200.0]), half_hours)

    assert aligned["actual_mw"].tolist() == [1000.0] and aligned["error_mw"].tolist() == [200.0]


def test_align_rejects_duplicate_actuals() -> None:
    dup = actual_frame([f"{DAY}T00:00:00Z"] * 2, [1.0, 2.0])

    with pytest.raises(ValueError, match="one row per start_time"):
        align(selected(hours(DAY, 1), [1.0]), dup)


def test_inputs_are_not_mutated() -> None:
    sel, act = selected(hours(DAY), F4), actual_frame(hours(DAY), A4)
    before = (sel.copy(), act.copy())

    compute_metrics(align(sel, act))

    pd.testing.assert_frame_equal(sel, before[0])
    pd.testing.assert_frame_equal(act, before[1])


def test_delivery_day_filter_uses_uk_dates() -> None:
    # 23:30 UTC on 15 Apr is 00:30 UK on 16 Apr (BST), so it belongs to 16 Apr.
    frame = selected(["2026-04-15T22:30:00Z", "2026-04-15T23:30:00Z"], [1.0, 2.0])

    kept = in_delivery_days(frame, date(2026, 4, 16), date(2026, 4, 16))

    assert kept["forecast_mw"].tolist() == [2.0]


# --- breakdowns ---------------------------------------------------------------------------


def test_breakdown_by_hour_uses_uk_hours_and_returns_all_24() -> None:
    bst = selected(["2026-04-15T23:00:00Z"], [10.0])  # 00:00 UK on 16 Apr
    aligned = align(bst, actual_frame(["2026-04-15T23:00:00Z"], [5.0]))

    groups = breakdown(aligned, "hour")

    assert [g["group"] for g in groups] == [f"{h:02d}" for h in range(24)]
    assert groups[0]["n"] == 1 and groups[23]["n"] == 0


def test_breakdown_by_level_bins_on_actual_with_left_closed_edges() -> None:
    times = hours(DAY, 4)
    aligned = align(
        selected(times, [1.0] * 4), actual_frame(times, [4999.0, 5000.0, 15000.0, 20000.0])
    )

    groups = {g["group"]: g["n"] for g in breakdown(aligned, "level")}

    assert groups == {"<5 GW": 1, "5–10 GW": 1, "10–15 GW": 0, "≥15 GW": 2}


def test_breakdown_by_day_and_unknown_dimension() -> None:
    times = [f"{DAY}T23:00:00Z", "2026-01-16T00:00:00Z"]
    aligned = align(selected(times, [1.0, 2.0]), actual_frame(times, [1.0, 1.0]))

    assert [g["group"] for g in breakdown(aligned, "day")] == ["2026-01-15", "2026-01-16"]
    with pytest.raises(ValueError, match="by must be"):
        breakdown(aligned, "week")  # type: ignore[arg-type]


def runs(horizons: list[float], start: str = f"{DAY}T12:00:00Z") -> pd.DataFrame:
    t = pd.Timestamp(start)
    return pd.DataFrame(
        {
            "start_time": [t] * len(horizons),
            "publish_time": [t - pd.Timedelta(hours=h) for h in horizons],
            "generation_mw": [1100.0] * len(horizons),
            "horizon_h": pd.Series(horizons, dtype="float32"),
        }
    )


def test_horizon_buckets_are_half_open_and_cover_up_to_72h() -> None:
    groups = horizon_breakdown(
        runs([0.0, 5.9, 6.0, 47.5, 48.0, 71.5]), actual_frame([f"{DAY}T12:00:00Z"], [1000.0])
    )

    assert [g["group"] for g in groups] == [
        "[0,6)",
        "[6,12)",
        "[12,24)",
        "[24,36)",
        "[36,48)",
        "[48,72)",
    ]
    assert [g["rows"] for g in groups] == [2, 1, 0, 0, 1, 2]
    assert groups[5]["n"] == 2 and groups[5]["bias"] == 100.0 and groups[5]["lowSample"] is True
    assert groups[2]["mae"] is None


@pytest.mark.parametrize("bad", [72.0, -0.5])
def test_horizon_outside_buckets_raises(bad: float) -> None:
    with pytest.raises(ValueError, match="outside buckets"):
        horizon_breakdown(runs([bad]), actual_frame([f"{DAY}T12:00:00Z"], [1000.0]))


def test_horizon_rows_without_actual_count_as_rows_not_samples() -> None:
    groups = horizon_breakdown(runs([1.0, 2.0]), actual_frame([], []))

    assert groups[0]["rows"] == 2 and groups[0]["n"] == 0 and groups[0]["mae"] is None


# --- determinism --------------------------------------------------------------------------


def test_outputs_do_not_depend_on_row_order() -> None:
    times = hours(DAY, 24)
    sel = selected(times, [1000.0 + 37 * h % 500 for h in range(24)])
    act = actual_frame(times, [900.0 + 11 * h for h in range(24)])
    shuffled = align(sel.sample(frac=1, random_state=3), act.sample(frac=1, random_state=4))

    assert compute_metrics(align(sel, act)) == compute_metrics(shuffled)
    assert breakdown(align(sel, act), "hour") == breakdown(shuffled, "hour")
    assert day_summary(align(sel, act), act) == day_summary(shuffled, act)
    many = runs([0.5 + 1.7 * i for i in range(40)])
    assert horizon_breakdown(many, act) == horizon_breakdown(
        many.sample(frac=1, random_state=5), act
    )
