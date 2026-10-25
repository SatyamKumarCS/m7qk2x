"""Processed data, loaded once (FR-2.10) and shared read-only by every request.

Loading is lazy and cached, so it works whether or not the host runs ASGI lifespan events
(the app also warms it at startup). Nothing is written at runtime (ADR 0001, E-26).
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from functools import cache
from typing import Any

import pandas as pd

from app import config

log = logging.getLogger("api")


class DataUnavailable(RuntimeError):
    """The processed files are missing or unreadable."""


@dataclass(frozen=True)
class DataStore:
    actuals: pd.DataFrame  # start_time, generation_mw, settlement_date, settlement_period
    forecasts: pd.DataFrame  # start_time, publish_time, generation_mw, horizon_h
    quality: dict[str, Any]  # quality_report.json (docs/spec.md §3)


@cache
def get_store() -> DataStore:
    """Load once per process; raises DataUnavailable (and retries on the next call) on failure."""
    folder = config.PROCESSED_DIR
    try:
        store = DataStore(
            actuals=pd.read_parquet(folder / "actuals.parquet"),
            forecasts=pd.read_parquet(folder / "forecasts.parquet"),
            quality=json.loads((folder / "quality_report.json").read_text()),
        )
    except (OSError, ValueError) as exc:
        raise DataUnavailable(f"processed data could not be loaded from {folder}: {exc}") from exc
    log.info("data loaded actuals=%d forecasts=%d", len(store.actuals), len(store.forecasts))
    return store


def try_store() -> DataStore | None:
    try:
        return get_store()
    except DataUnavailable as exc:
        get_store.cache_clear()  # do not cache the failure
        log.error("%s", exc)
        return None
