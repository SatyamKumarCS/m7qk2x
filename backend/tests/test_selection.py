from datetime import date, time

import pandas as pd
import pytest

from app import config
from app.selection import (
    cutoff_for,
    parse_cutoff_clock,
    select_by_min_horizon,
    select_forecasts,
    target_grid,
)

EPEX, EARLY = time(9, 20), time(6, 0)


def ts(value: str) -> pd.Timestamp:
    return pd.Timestamp(value, tz="UTC")


def runs(*rows: tuple[str, str, float]) -> pd.DataFrame:
    """Forecast rows as (start_time, publish_time, generation_mw), UTC."""
    return pd.DataFrame(
        {
            "start_time": pd.to_datetime([r[0] for r in rows], utc=True, format="ISO8601"),
            "publish_time": pd.to_datetime([r[1] for r in rows], utc=True, format="ISO8601"),
            "generation_mw": [float(r[2]) for r in rows],
        }
    )


def targets(*values: str) -> pd.DatetimeIndex:
    return pd.DatetimeIndex(pd.to_datetime(list(values), utc=True, format="ISO8601"))


def pick(forecasts: pd.DataFrame, target: str, clock: time = EPEX) -> pd.Series:
    out = select_forecasts(forecasts, targets(target), clock)
    assert len(out) == 1
    return out.iloc[0]


T = "2026-01-15T12:00:00Z"  # delivery day 15 Jan, so the 09:20 cutoff is 14 Jan 09:20 UTC


# --- PRD §11.1 tests 1-8 ----------------------------------------------------------------


def test_1_forecast_published_one_minute_after_cutoff_is_ignored() -> None:
    row = pick(runs((T, "2026-01-14T07:30Z", 100), (T, "2026-01-14T09:21Z", 999)), T)

    assert row["forecast_mw"] == 100 and row["publish_time"] == ts("2026-01-14T07:30Z")


def test_2_forecast_published_exactly_at_cutoff_is_used() -> None:
    row = pick(runs((T, "2026-01-14T07:30Z", 100), (T, "2026-01-14T09:20Z", 200)), T)

    assert row["forecast_mw"] == 200


def test_3_latest_run_before_cutoff_is_chosen() -> None:
    row = pick(runs((T, "2026-01-14T04:30Z", 100), (T, "2026-01-14T08:00Z", 200)), T)

    assert row["forecast_mw"] == 200 and row["publish_time"] == ts("2026-01-14T08:00Z")


def test_4_target_with_only_post_cutoff_runs_is_null_not_the_later_value() -> None:
    row = pick(runs((T, "2026-01-14T09:30Z", 999), (T, "2026-01-15T02:30Z", 888)), T)

    assert pd.isna(row["forecast_mw"]) and pd.isna(row["publish_time"])
    assert pd.isna(row["horizon_h"])


def test_5_late_evening_target_uses_cutoff_on_previous_day() -> None:
    late = "2026-01-15T23:00:00Z"  # still delivery day 15 Jan: cutoff 14 Jan, not 15 Jan
    row = pick(runs((late, "2026-01-14T07:30Z", 100), (late, "2026-01-15T07:30Z", 999)), late)

    assert row["forecast_mw"] == 100
    assert row["limit_time"] == ts("2026-01-14T09:20Z")


def test_6_changing_cutoff_changes_the_selected_run() -> None:
    forecasts = runs((T, "2026-01-14T04:30Z", 100), (T, "2026-01-14T07:30Z", 200))

    assert pick(forecasts, T, EPEX)["forecast_mw"] == 200
    assert pick(forecasts, T, EARLY)["forecast_mw"] == 100


def test_7_horizon_is_hours_from_publish_to_target() -> None:
    row = pick(runs((T, "2026-01-14T04:30Z", 100)), T)

    assert row["horizon_h"] == 31.5


def test_8_duplicate_rows_do_not_create_duplicate_output_rows() -> None:
    forecasts = runs((T, "2026-01-14T07:30Z", 100), (T, "2026-01-14T07:30Z", 100))

    out = select_forecasts(forecasts, targets(T, T), EPEX)

    assert len(out) == 1 and out["forecast_mw"].tolist() == [100]


# --- missing runs, ties, ordering -------------------------------------------------------


def test_target_with_no_rows_at_all_keeps_a_null_row() -> None:
    other = "2026-01-15T13:00:00Z"
    out = select_forecasts(runs((T, "2026-01-14T07:30Z", 100)), targets(T, other), EPEX)

    assert out["start_time"].tolist() == [ts(T), ts(other)]
    assert out["forecast_mw"].isna().tolist() == [False, True]


def test_conflicting_tie_resolves_to_last_row_in_input_order() -> None:
    forecasts = runs((T, "2026-01-14T07:30Z", 100), (T, "2026-01-14T07:30Z", 150))

    assert pick(forecasts, T)["forecast_mw"] == 150
    assert pick(forecasts.iloc[::-1], T)["forecast_mw"] == 100


def test_output_is_sorted_unique_and_does_not_mutate_input() -> None:
    forecasts = runs((T, "2026-01-14T07:30Z", 100))
    before = forecasts.copy()

    out = select_forecasts(forecasts, targets("2026-01-15T13:00Z", T, T), EPEX)

    assert out["start_time"].is_monotonic_increasing and out["start_time"].is_unique
    assert list(out.columns) == [
        "start_time",
        "forecast_mw",
        "publish_time",
        "horizon_h",
        "limit_time",
    ]
    pd.testing.assert_frame_equal(forecasts, before)


def test_selection_is_deterministic_across_input_order() -> None:
    forecasts = runs(
        (T, "2026-01-14T04:30Z", 100),
        (T, "2026-01-14T07:30Z", 200),
        ("2026-01-15T13:00Z", "2026-01-14T07:30Z", 300),
    )
    grid = targets(T, "2026-01-15T13:00Z")

    first = select_forecasts(forecasts, grid, EPEX)
    shuffled = select_forecasts(forecasts.sample(frac=1, random_state=7), grid, EPEX)

    pd.testing.assert_frame_equal(first, shuffled)


# --- UK time and clock changes (E-6, E-18) ----------------------------------------------


def test_cutoff_is_uk_wall_clock_in_bst() -> None:
    # 15 Apr 2026 is BST (UTC+1): the 09:20 UK cutoff on 14 Apr is 08:20 UTC.
    bst = "2026-04-15T12:00:00Z"
    forecasts = runs((bst, "2026-04-14T08:15Z", 100), (bst, "2026-04-14T08:30Z", 999))

    row = pick(forecasts, bst)

    assert row["limit_time"] == ts("2026-04-14T08:20Z")
    assert row["forecast_mw"] == 100


def test_bst_target_after_uk_midnight_belongs_to_next_delivery_day() -> None:
    # 23:30 UTC on 15 Apr is 00:30 UK on 16 Apr, so its cutoff is 15 Apr 09:20 UK.
    target = pd.Series([ts("2026-04-15T23:30Z")])

    assert cutoff_for(target, EPEX).tolist() == [ts("2026-04-15T08:20Z")]


def test_cutoff_inside_clock_change_resolves_to_earliest_instant() -> None:
    autumn = pd.Series([ts("2026-10-26T12:00Z")])  # D-1 = 25 Oct; 01:30 UK happens twice
    spring = pd.Series([ts("2026-03-30T12:00Z")])  # D-1 = 29 Mar; 01:30 UK never happens

    assert cutoff_for(autumn, time(1, 30)).tolist() == [ts("2026-10-25T00:30Z")]
    assert cutoff_for(spring, time(1, 30)).iloc[0] < ts("2026-03-29T01:00Z")


def test_target_grid_is_hourly_in_uk_days() -> None:
    january = target_grid(config.DELIVERY_START, config.DELIVERY_END)
    bst_day = target_grid(date(2026, 4, 15), date(2026, 4, 15))

    assert len(january) == 744 and january[0] == ts("2026-01-02T00:00Z")
    assert january[-1] == ts("2026-02-01T23:00Z")
    assert len(bst_day) == 24 and bst_day[0] == ts("2026-04-14T23:00Z")
    assert len(target_grid(date(2026, 3, 29), date(2026, 3, 29))) == 23


# --- minimum-horizon variant ------------------------------------------------------------


def test_min_horizon_picks_latest_run_at_least_that_far_ahead() -> None:
    forecasts = runs((T, "2026-01-14T12:00Z", 100), (T, "2026-01-15T00:00Z", 200))

    at_12 = select_by_min_horizon(forecasts, targets(T), 12).iloc[0]
    at_13 = select_by_min_horizon(forecasts, targets(T), 13).iloc[0]

    assert at_12["forecast_mw"] == 200 and at_12["horizon_h"] == 12  # boundary is inclusive
    assert at_13["forecast_mw"] == 100 and at_13["horizon_h"] == 24


def test_min_horizon_rejects_negative_values() -> None:
    with pytest.raises(ValueError, match="min_horizon_h"):
        select_by_min_horizon(runs((T, "2026-01-14T07:30Z", 1)), targets(T), -1)


# --- input validation -------------------------------------------------------------------


@pytest.mark.parametrize("value", ["09:20", "00:00", "23:59"])
def test_parse_cutoff_clock_accepts_hh_mm(value: str) -> None:
    assert parse_cutoff_clock(value).strftime("%H:%M") == value


@pytest.mark.parametrize("value", ["25:00", "9:20", "09:60", "0920", ""])
def test_parse_cutoff_clock_rejects_bad_values(value: str) -> None:
    with pytest.raises(ValueError, match="HH:MM"):
        parse_cutoff_clock(value)


def test_naive_timestamps_are_rejected() -> None:
    naive = runs((T, "2026-01-14T07:30Z", 1)).assign(
        publish_time=lambda d: d["publish_time"].dt.tz_localize(None)
    )

    with pytest.raises(ValueError, match="timezone-aware"):
        select_forecasts(naive, targets(T), EPEX)


def test_missing_forecast_column_is_named() -> None:
    with pytest.raises(ValueError, match="generation_mw"):
        no_values = runs((T, "2026-01-14T07:30Z", 1)).drop(columns="generation_mw")
        select_forecasts(no_values, targets(T), EPEX)


# --- invariants on the committed processed dataset --------------------------------------


@pytest.fixture(scope="module")
def processed_forecasts() -> pd.DataFrame:
    path = config.PROCESSED_DIR / "forecasts.parquet"
    if not path.exists():
        pytest.skip("processed data not built; run `make data`")
    return pd.read_parquet(path)


@pytest.mark.parametrize(
    ("clock", "run_clock", "horizons"),
    [
        ("09:20", "07:30", (16.5, 39.5)),
        ("09:50", "09:30", (14.5, 37.5)),
        ("06:00", "04:30", (19.5, 42.5)),
    ],
)
def test_real_data_uses_expected_run_and_never_a_later_one(
    processed_forecasts: pd.DataFrame, clock: str, run_clock: str, horizons: tuple[float, float]
) -> None:
    grid = target_grid(config.DELIVERY_START, config.DELIVERY_END)

    out = select_forecasts(processed_forecasts, grid, parse_cutoff_clock(clock))

    assert len(out) == 744 and out["forecast_mw"].notna().all()
    assert (out["publish_time"] <= out["limit_time"]).all()
    assert set(out["publish_time"].dt.strftime("%H:%M")) == {run_clock}
    assert (out["publish_time"].dt.date == out["limit_time"].dt.date).all()  # run is on D-1
    assert (out["horizon_h"].min(), out["horizon_h"].max()) == horizons
