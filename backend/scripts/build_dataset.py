"""Turn the raw Elexon JSON from fetch_data.py into clean parquet files and a quality report.

Run from backend/:  python -m scripts.build_dataset

Reads the files listed in data/raw/manifest.json and writes, to data/processed/:
actuals.parquet and forecasts.parquet (schemas in PRD §9.2) and quality_report.json
(docs/spec.md §3). Cleaning rules are PRD edge cases E-3, E-4, E-10, E-11, E-12 and E-13.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pandas as pd

from app import config
from scripts.fetch_data import DATASETS

log = logging.getLogger("build_dataset")

REQUIRED = {ds.name: ds.required_fields for ds in DATASETS}
Stats = dict[str, Any]


class BuildError(RuntimeError):
    """The raw inputs are missing or malformed."""


def _iso(ts: pd.Timestamp) -> str:
    return ts.strftime("%Y-%m-%dT%H:%M:%SZ")


def _utc(values: pd.Series) -> pd.Series:
    # pandas 3 parses strings to microseconds; PRD §9.2 specifies datetime64[ns, UTC].
    return pd.to_datetime(values, utc=True).dt.as_unit("ns")


def _require(df: pd.DataFrame, name: str) -> None:
    missing = [field for field in REQUIRED[name] if field not in df.columns]
    if missing:
        raise BuildError(f"{name}: raw data is missing field(s) {', '.join(missing)}")


def _drop_nulls(df: pd.DataFrame, stats: Stats) -> pd.DataFrame:
    """E-12: coerce generation to numbers; drop rows where it or a timestamp is missing."""
    df = df.assign(generation=pd.to_numeric(df["generation"], errors="coerce"))
    bad = df[["generation", "startTime", "publishTime"]].isna().any(axis=1)
    stats["nulls"] = int(bad.sum())
    return df[~bad]


def _drop_exact_duplicates(df: pd.DataFrame, stats: Stats) -> pd.DataFrame:
    """E-3: rows identical in every field are dropped and counted."""
    deduped = df.drop_duplicates()
    stats["duplicates"] = len(df) - len(deduped)
    return deduped


def _value_flags(generation: pd.Series, start_time: pd.Series, stats: Stats) -> None:
    """E-11 counts negatives (kept); E-13 flags spikes above the threshold (kept)."""
    spikes = generation > config.SPIKE_THRESHOLD_MW
    stats["negatives"] = int((generation < 0).sum())
    stats["spikes"] = int(spikes.sum())
    stats["spikeTimes"] = [_iso(t) for t in start_time[spikes]]
    if stats["spikes"]:
        limit = config.SPIKE_THRESHOLD_MW
        log.warning("spikes=%d above %d MW (flagged, kept)", stats["spikes"], limit)


def clean_actuals(raw: pd.DataFrame) -> tuple[pd.DataFrame, Stats]:
    """Clean FUELHH rows into the actuals schema (one row per start_time)."""
    _require(raw, "fuelhh")
    stats: Stats = {}
    wind = raw["fuelType"] == "WIND"
    stats["nonWindDropped"] = int((~wind).sum())
    df = _drop_exact_duplicates(_drop_nulls(raw[wind], stats), stats)
    df = df.assign(start_time=_utc(df["startTime"]), publish_time=_utc(df["publishTime"]))
    # E-10: a revised period keeps its latest publishTime; a stable sort keeps file order on ties.
    df = df.sort_values(["start_time", "publish_time"], kind="stable")
    latest = df.drop_duplicates("start_time", keep="last")
    stats["revisionsCollapsed"] = len(df) - len(latest)
    out = pd.DataFrame(
        {
            "start_time": latest["start_time"],
            "generation_mw": latest["generation"].astype("float64"),
            "settlement_date": pd.to_datetime(latest["settlementDate"]).dt.date,
            "settlement_period": latest["settlementPeriod"].astype("int8"),
        }
    ).reset_index(drop=True)
    _value_flags(out["generation_mw"], out["start_time"], stats)
    return out, stats


def clean_forecasts(raw: pd.DataFrame) -> tuple[pd.DataFrame, Stats]:
    """Clean WINDFOR rows into the forecasts schema (one row per start_time, publish_time)."""
    _require(raw, "windfor")
    stats: Stats = {}
    df = _drop_exact_duplicates(_drop_nulls(raw, stats), stats)
    df = df.assign(start_time=_utc(df["startTime"]), publish_time=_utc(df["publishTime"]))
    # E-3: same run and target with different values: keep the last row as returned, and warn.
    deduped = df.drop_duplicates(["start_time", "publish_time"], keep="last")
    stats["conflictingDuplicates"] = len(df) - len(deduped)
    if stats["conflictingDuplicates"]:
        log.warning("conflicting duplicates=%d (kept last as returned)", len(df) - len(deduped))
    # E-4: a value for a target that had already started when the run was published.
    late = deduped["publish_time"] > deduped["start_time"]
    stats["droppedPublishedAfterTarget"] = int(late.sum())
    kept = deduped[~late].sort_values(["start_time", "publish_time"], kind="stable")
    horizon = (kept["start_time"] - kept["publish_time"]) / pd.Timedelta(hours=1)
    out = pd.DataFrame(
        {
            "start_time": kept["start_time"],
            "publish_time": kept["publish_time"],
            "generation_mw": kept["generation"].astype("float64"),
            "horizon_h": horizon.astype("float32"),
        }
    ).reset_index(drop=True)
    _value_flags(out["generation_mw"], out["start_time"], stats)
    return out, stats


def _resolution_minutes(times: pd.Series, expected: int, what: str) -> int:
    steps = times.sort_values().diff().dropna() / pd.Timedelta(minutes=1)
    minutes = int(steps.mode().iloc[0]) if len(steps) else 0
    if minutes != expected:
        log.warning("%s resolution is %d min, expected %d", what, minutes, expected)
    return minutes


def actuals_report(df: pd.DataFrame, stats: Stats) -> dict[str, Any]:
    start, end = config.FETCH_ACTUALS
    grid = pd.date_range(str(start), str(end), freq="30min", inclusive="left", tz="UTC")
    missing = grid.difference(pd.DatetimeIndex(df["start_time"]))
    return {
        "rows": len(df),
        "expected": len(grid),
        "missingSlots": [_iso(t) for t in missing],
        **{k: stats[k] for k in ("duplicates", "revisionsCollapsed", "nonWindDropped", "nulls")},
        **{k: stats[k] for k in ("negatives", "spikes", "spikeTimes")},
        "startTimeRange": [_iso(df["start_time"].min()), _iso(df["start_time"].max())],
        "generationRangeMw": [float(df["generation_mw"].min()), float(df["generation_mw"].max())],
        "resolutionMinutes": _resolution_minutes(
            df["start_time"], config.ACTUAL_RESOLUTION_MIN, "actuals"
        ),
    }


def forecasts_report(df: pd.DataFrame, stats: Stats) -> dict[str, Any]:
    publish = df["publish_time"].drop_duplicates()
    per_day = publish.dt.date.value_counts().value_counts().sort_index()
    clocks = publish.dt.strftime("%H:%M").value_counts().sort_index()
    one_run = df.loc[df["publish_time"] == publish.iloc[0], "start_time"]
    return {
        "rows": len(df),
        "runs": len(publish),
        "runsPerPublishDay": {str(k): int(v) for k, v in per_day.items()},
        "publishClockTimes": {str(k): int(v) for k, v in clocks.items()},
        **{k: stats[k] for k in ("duplicates", "conflictingDuplicates")},
        **{k: stats[k] for k in ("droppedPublishedAfterTarget", "nulls")},
        **{k: stats[k] for k in ("negatives", "spikes", "spikeTimes")},
        "publishTimeRange": [_iso(publish.min()), _iso(publish.max())],
        "startTimeRange": [_iso(df["start_time"].min()), _iso(df["start_time"].max())],
        "horizonRangeH": [float(df["horizon_h"].min()), float(df["horizon_h"].max())],
        "generationRangeMw": [float(df["generation_mw"].min()), float(df["generation_mw"].max())],
        "resolutionMinutes": _resolution_minutes(
            one_run, config.FORECAST_RESOLUTION_MIN, "forecasts"
        ),
    }


def load_raw(raw_dir: Path) -> tuple[dict[str, pd.DataFrame], list[dict[str, str]]]:
    """Load the files listed in the fetch manifest, in order, with a checksum per input."""
    manifest_path = raw_dir / "manifest.json"
    if not manifest_path.exists():
        raise BuildError(f"{manifest_path} not found; run `python -m scripts.fetch_data` first")
    frames: dict[str, list[pd.DataFrame]] = {name: [] for name in REQUIRED}
    inputs = []
    for entry in json.loads(manifest_path.read_text())["files"]:
        body = (raw_dir / entry["file"]).read_bytes()
        payload = json.loads(body)
        rows = payload["data"] if isinstance(payload, dict) else payload
        frames[entry["file"].split("_", 1)[0]].append(pd.DataFrame(rows))
        inputs.append({"file": entry["file"], "sha256": hashlib.sha256(body).hexdigest()})
    if not all(frames.values()):
        raise BuildError(f"manifest must list files for every dataset: {sorted(REQUIRED)}")
    combined = {name: pd.concat(parts, ignore_index=True) for name, parts in frames.items()}
    return combined, inputs


def _write_atomic(path: Path, write: Callable[[Path], object]) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    write(tmp)
    os.replace(tmp, path)


def build(raw_dir: Path, out_dir: Path) -> dict[str, Any]:
    """Build both parquet files and the quality report; return the report."""
    raw, inputs = load_raw(raw_dir)
    actuals, actual_stats = clean_actuals(raw["fuelhh"])
    forecasts, forecast_stats = clean_forecasts(raw["windfor"])
    report = {
        "inputs": inputs,
        "actuals": actuals_report(actuals, actual_stats),
        "forecasts": forecasts_report(forecasts, forecast_stats),
    }
    out_dir.mkdir(parents=True, exist_ok=True)
    for name, df in (("actuals", actuals), ("forecasts", forecasts)):
        _write_atomic(out_dir / f"{name}.parquet", lambda p, df=df: df.to_parquet(p, index=False))
    text = json.dumps(report, indent=2) + "\n"
    _write_atomic(out_dir / "quality_report.json", lambda p: p.write_text(text))
    return report


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    report = build(config.RAW_DIR, config.PROCESSED_DIR)
    a, f = report["actuals"], report["forecasts"]
    log.info(
        "actuals rows=%d expected=%d missing=%d duplicates=%d revisions=%d negatives=%d "
        "nulls=%d spikes=%d resolution=%dmin",
        a["rows"], a["expected"], len(a["missingSlots"]), a["duplicates"],
        a["revisionsCollapsed"], a["negatives"], a["nulls"], a["spikes"], a["resolutionMinutes"],
    )  # fmt: skip
    log.info(
        "forecasts rows=%d runs=%d runs/day=%s clock=%s duplicates=%d conflicting=%d "
        "droppedPublishedAfterTarget=%d negatives=%d nulls=%d spikes=%d resolution=%dmin",
        f["rows"], f["runs"], f["runsPerPublishDay"], ",".join(f["publishClockTimes"]),
        f["duplicates"], f["conflictingDuplicates"], f["droppedPublishedAfterTarget"],
        f["negatives"], f["nulls"], f["spikes"], f["resolutionMinutes"],
    )  # fmt: skip
    outputs = "actuals.parquet, forecasts.parquet, quality_report.json"
    log.info("wrote %s to %s", outputs, config.PROCESSED_DIR)


if __name__ == "__main__":
    try:
        main()
    except BuildError as exc:
        log.error("build failed: %s", exc)
        raise SystemExit(1) from exc
