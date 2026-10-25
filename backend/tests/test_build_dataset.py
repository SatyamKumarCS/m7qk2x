import json
import logging
from pathlib import Path

import pandas as pd
import pytest

from app import config
from scripts.build_dataset import BuildError, build, clean_actuals, clean_forecasts

Generation = float | str | None


def actual(
    start: str, generation: Generation = 9000, publish: str | None = None, **kw: str
) -> dict:
    ts = pd.Timestamp(start)
    return {
        "dataset": "FUELHH",
        "publishTime": publish or (ts + pd.Timedelta(minutes=30)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "startTime": start,
        "settlementDate": ts.strftime("%Y-%m-%d"),
        "settlementPeriod": ts.hour * 2 + ts.minute // 30 + 1,
        "fuelType": "WIND",
        "generation": generation,
    } | kw


def forecast(
    start: str, publish: str = "2026-01-14T07:30:00Z", generation: Generation = 12000
) -> dict:
    return {
        "dataset": "WINDFOR",
        "publishTime": publish,
        "startTime": start,
        "generation": generation,
    }


T1, T2 = "2026-01-15T00:00:00Z", "2026-01-15T01:00:00Z"


# --- E-3 duplicates ---------------------------------------------------------------------


def test_exact_duplicates_are_dropped_and_counted() -> None:
    raw = pd.DataFrame([forecast(T1), forecast(T1), forecast(T2)])

    out, stats = clean_forecasts(raw)

    assert len(out) == 2 and stats["duplicates"] == 1 and stats["conflictingDuplicates"] == 0


def test_conflicting_duplicate_keeps_last_row_and_warns(caplog: pytest.LogCaptureFixture) -> None:
    raw = pd.DataFrame([forecast(T1, generation=11000), forecast(T1, generation=11500)])

    with caplog.at_level(logging.WARNING):
        out, stats = clean_forecasts(raw)

    assert out["generation_mw"].tolist() == [11500.0]
    assert stats["conflictingDuplicates"] == 1
    assert "conflicting duplicates=1" in caplog.text


# --- E-4 published after target ---------------------------------------------------------


def test_rows_published_after_their_target_are_dropped() -> None:
    raw = pd.DataFrame(
        [
            forecast("2026-01-14T07:00:00Z"),  # published 30 min after the target started
            forecast("2026-01-14T07:30:00Z"),  # published exactly at the target: kept
            forecast(T1),
        ]
    )

    out, stats = clean_forecasts(raw)

    assert stats["droppedPublishedAfterTarget"] == 1
    assert out["horizon_h"].tolist() == [0.0, 16.5]


# --- E-10 FUELHH revisions --------------------------------------------------------------


def test_revised_actual_keeps_latest_publish_time() -> None:
    raw = pd.DataFrame(
        [
            actual(T1, generation=10000, publish="2026-01-15T03:00:00Z"),  # later revision
            actual(T1, generation=9000),  # original, published at 00:30
        ]
    )

    out, stats = clean_actuals(raw)

    assert out["generation_mw"].tolist() == [10000.0]
    assert stats["revisionsCollapsed"] == 1


# --- E-11 negatives, E-12 nulls, E-13 spikes --------------------------------------------


def test_negatives_are_kept_and_counted() -> None:
    actuals, a_stats = clean_actuals(pd.DataFrame([actual(T1, generation=-12)]))
    forecasts, f_stats = clean_forecasts(pd.DataFrame([forecast(T1, generation=-5)]))

    assert actuals["generation_mw"].tolist() == [-12.0] and a_stats["negatives"] == 1
    assert forecasts["generation_mw"].tolist() == [-5.0] and f_stats["negatives"] == 1


def test_null_and_non_numeric_generation_are_dropped_and_counted() -> None:
    raw = pd.DataFrame([forecast(T1, generation=None), forecast(T2, generation="n/a")])
    raw = pd.concat([raw, pd.DataFrame([forecast("2026-01-15T02:00:00Z")])], ignore_index=True)

    out, stats = clean_forecasts(raw)

    assert len(out) == 1 and stats["nulls"] == 2


def test_spikes_are_flagged_not_dropped() -> None:
    out, stats = clean_actuals(pd.DataFrame([actual(T1, generation=config.SPIKE_THRESHOLD_MW + 1)]))

    assert len(out) == 1
    assert stats["spikes"] == 1 and stats["spikeTimes"] == [T1]


def test_non_wind_rows_are_filtered() -> None:
    out, stats = clean_actuals(pd.DataFrame([actual(T1), actual(T1, fuelType="CCGT")]))

    assert len(out) == 1 and stats["nonWindDropped"] == 1


# --- schema -----------------------------------------------------------------------------


def test_output_schemas_match_prd() -> None:
    actuals, _ = clean_actuals(pd.DataFrame([actual(T1)]))
    forecasts, _ = clean_forecasts(pd.DataFrame([forecast(T1)]))

    assert dict(actuals.dtypes.astype(str)) == {
        "start_time": "datetime64[ns, UTC]",
        "generation_mw": "float64",
        "settlement_date": "object",
        "settlement_period": "int8",
    }
    assert dict(forecasts.dtypes.astype(str)) == {
        "start_time": "datetime64[ns, UTC]",
        "publish_time": "datetime64[ns, UTC]",
        "generation_mw": "float64",
        "horizon_h": "float32",
    }


def test_missing_raw_field_is_named() -> None:
    raw = pd.DataFrame([forecast(T1)]).drop(columns="generation")

    with pytest.raises(BuildError, match="missing field\\(s\\) generation"):
        clean_forecasts(raw)


# --- end to end -------------------------------------------------------------------------


def write_raw(raw_dir: Path, actual_rows: list[dict], forecast_rows: list[dict]) -> None:
    raw_dir.mkdir()
    files = {"fuelhh_a.json": actual_rows, "windfor_a.json": forecast_rows}
    for name, rows in files.items():
        (raw_dir / name).write_text(json.dumps(rows))
    manifest = {"files": [{"file": name} for name in files]}
    (raw_dir / "manifest.json").write_text(json.dumps(manifest))


def test_build_writes_outputs_report_and_is_deterministic(tmp_path: Path) -> None:
    raw_dir, out_dir = tmp_path / "raw", tmp_path / "processed"
    write_raw(raw_dir, [actual(T1), actual("2026-01-15T00:30:00Z")], [forecast(T1), forecast(T2)])

    report = build(raw_dir, out_dir)
    first = {p.name: p.read_bytes() for p in out_dir.iterdir()}
    build(raw_dir, out_dir)

    assert {p.name: p.read_bytes() for p in out_dir.iterdir()} == first
    assert set(first) == {"actuals.parquet", "forecasts.parquet", "quality_report.json"}
    assert report["actuals"]["expected"] == 32 * 48  # fetch window, 30-min slots
    assert len(report["actuals"]["missingSlots"]) == 32 * 48 - 2
    assert report["actuals"]["resolutionMinutes"] == 30
    assert report["forecasts"]["runs"] == 1
    assert report["forecasts"]["publishClockTimes"] == {"07:30": 1}
    assert report["forecasts"]["resolutionMinutes"] == 60
    assert [i["file"] for i in report["inputs"]] == ["fuelhh_a.json", "windfor_a.json"]


def test_build_without_manifest_explains_how_to_fetch(tmp_path: Path) -> None:
    with pytest.raises(BuildError, match="run `python -m scripts.fetch_data` first"):
        build(tmp_path, tmp_path / "processed")
