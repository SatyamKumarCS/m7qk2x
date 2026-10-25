from datetime import date

import pandas as pd
import pytest

from app import config
from app.metrics import (
    align,
    compute_metrics,
    coverage,
    day_summary,
    horizon_breakdown,
    in_delivery_days,
)
from app.selection import parse_cutoff_clock, select_forecasts, target_grid

# --- real committed data: matches notebooks 01/02 and ADR 0008 -------------------------


@pytest.fixture(scope="module")
def real() -> dict[str, pd.DataFrame]:
    paths = [config.PROCESSED_DIR / f"{n}.parquet" for n in ("actuals", "forecasts")]
    if not all(p.exists() for p in paths):
        pytest.skip("processed data not built; run `make data`")
    actuals, forecasts = (pd.read_parquet(p) for p in paths)
    grid = target_grid(config.DELIVERY_START, config.DELIVERY_END)
    sel = select_forecasts(forecasts, grid, parse_cutoff_clock("09:20"))
    return {"actuals": actuals, "forecasts": forecasts, "aligned": align(sel, actuals)}


def test_real_headline_metrics_match_notebook(real: dict[str, pd.DataFrame]) -> None:
    result = compute_metrics(real["aligned"])
    m = result["metrics"]

    assert result["counts"] == {"n": 744, "missingForecast": 0, "missingActual": 0}
    assert m["mae"] == pytest.approx(2022.47, abs=0.01)
    assert m["rmse"] == pytest.approx(2497.41, abs=0.01)
    assert m["bias"] == pytest.approx(1745.94, abs=0.01)
    assert m["r"] == pytest.approx(0.932, abs=0.0005)


def test_real_horizon_buckets_match_adr_0008(real: dict[str, pd.DataFrame]) -> None:
    groups = horizon_breakdown(real["forecasts"], real["actuals"])

    assert [g["rows"] for g in groups] == [1632, 1632, 3264, 3264, 3230, 2753]
    assert [g["n"] for g in groups] == [1494, 1504, 3050, 3072, 3040, 2591]
    assert [round(g["mae"]) for g in groups] == [1766, 1829, 1964, 2074, 2292, 2349]
    assert groups[-1]["ukHoursPresent"] == 19 and groups[0]["ukHoursPresent"] == 24


@pytest.mark.parametrize(
    ("level", "q", "expected"), [(80, (-426.4, 4154.4), 0.798), (90, (-1038.65, 5268.35), 0.898)]
)
def test_real_coverage_reproduces_notebook_02(
    real: dict[str, pd.DataFrame], level: int, q: tuple[float, float], expected: float
) -> None:
    # Band built here only to test the counting; production band construction is ticket 010.
    a = real["aligned"]
    lower, upper = (a["forecast_mw"] - q[1]).clip(lower=0), (a["forecast_mw"] - q[0]).clip(lower=0)

    assert coverage(a, lower, upper)["coverage"] == pytest.approx(expected, abs=0.0005)


def test_real_day_summary_for_15_january(real: dict[str, pd.DataFrame]) -> None:
    day = in_delivery_days(real["aligned"], date(2026, 1, 15), date(2026, 1, 15))

    s = day_summary(day, real["actuals"])

    assert (s["points"], s["forecastHours"], s["actualHours"]) == (24, 24, 24)
    assert s["forecastMwh"] == pytest.approx(278_630, abs=1)
    assert s["actualMwh"] == pytest.approx(253_626, abs=1)


def test_real_delivery_day_filter_after_selection_keeps_pre_window_runs(
    real: dict[str, pd.DataFrame],
) -> None:
    first = in_delivery_days(real["aligned"], config.DELIVERY_START, config.DELIVERY_START)

    assert len(first) == 24 and first["valid"].all()
    assert (first["publish_time"].dt.date == date(2026, 1, 1)).all()  # published before the window
