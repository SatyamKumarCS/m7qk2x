"""Band construction on the committed data must reproduce notebook 02 (band method evaluation)."""

import pandas as pd
import pytest

from app import config
from app.band import contains_forecast, cutoff_calibrations, planning_band
from app.metrics import align, day_summary, in_delivery_days
from app.selection import parse_cutoff_clock, select_forecasts, target_grid

# cutoff, level -> (q_lo, q_hi, in-sample coverage, held-out coverage, held-out below-band share)
NOTEBOOK_02 = {
    ("09:20", 80): (-426.40, 4154.40, 0.798, 0.784, 0.141),
    ("09:20", 90): (-1038.65, 5268.35, 0.898, 0.873, 0.111),
    ("09:50", 80): (-502.70, 4183.90, 0.798, 0.768, 0.149),
    ("09:50", 90): (-1041.40, 5319.00, 0.898, 0.879, 0.111),
}


@pytest.fixture(scope="module")
def data() -> tuple[pd.DataFrame, pd.DataFrame]:
    paths = [config.PROCESSED_DIR / f"{n}.parquet" for n in ("forecasts", "actuals")]
    if not all(p.exists() for p in paths):
        pytest.skip("processed data not built; run `make data`")
    return pd.read_parquet(paths[0]), pd.read_parquet(paths[1])


@pytest.fixture(scope="module")
def results(data: tuple[pd.DataFrame, pd.DataFrame]) -> dict:
    return cutoff_calibrations(*data)


def test_every_preset_cutoff_is_calibrated_for_both_levels(results: dict) -> None:
    assert set(results) == set(config.CUTOFF_PRESETS.values())
    assert all(set(levels) == {80, 90} for levels in results.values())
    assert all(
        r["calibration"].ok and r["calibration"].n == 744
        for lv in results.values()
        for r in lv.values()
    )


@pytest.mark.parametrize(("cutoff", "level"), list(NOTEBOOK_02))
def test_matches_notebook_02(results: dict, cutoff: str, level: int) -> None:
    q_lo, q_hi, in_sample, held_out, below = NOTEBOOK_02[(cutoff, level)]
    r = results[cutoff][level]

    assert (r["calibration"].q_lo, r["calibration"].q_hi) == (
        pytest.approx(q_lo),
        pytest.approx(q_hi),
    )
    assert r["inSample"]["coverage"] == pytest.approx(in_sample, abs=0.0005)
    assert r["heldOut"]["coverage"] == pytest.approx(held_out, abs=0.0005)
    assert r["heldOut"]["belowShare"] == pytest.approx(below, abs=0.0005)
    assert r["heldOut"]["evalDays"] == 23 and r["heldOut"]["calibrationsWithPositiveQLo"] == 0


def test_real_band_for_15_january(data: tuple[pd.DataFrame, pd.DataFrame], results: dict) -> None:
    forecasts, actuals = data
    grid = target_grid(config.DELIVERY_START, config.DELIVERY_END)
    aligned = align(select_forecasts(forecasts, grid, parse_cutoff_clock("09:20")), actuals)
    day = in_delivery_days(
        aligned, pd.Timestamp("2026-01-15").date(), pd.Timestamp("2026-01-15").date()
    )

    band = planning_band(day, results["09:20"][80]["calibration"])
    summary = day_summary(day, actuals, band)

    assert len(band) == 24 and (band["lower"] >= 0).all() and (band["lower"] <= band["upper"]).all()
    # Containment holds on this data (q_lo < 0); it is a diagnostic, not asserted in general.
    assert contains_forecast(band)["all"]
    assert summary["coverage"] == {
        "inside": 24,
        "below": 0,
        "above": 0,
        "valid": 24,
        "coverage": 1.0,
    }
