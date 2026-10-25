"""Download raw Elexon FUELHH (WIND) and WINDFOR data for the configured fetch windows.

Run from backend/:  python -m scripts.fetch_data

Each 7-day chunk is saved byte-for-byte as returned to data/raw/<dataset>_<first>_<last>.json
(inclusive dates), plus a manifest.json summary. Re-running overwrites the same files.
API facts (params, bound inclusivity, shapes) are verified in docs/data_notes.md.
"""

from __future__ import annotations

import json
import logging
import os
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Protocol

import requests
from tenacity import RetryCallState, Retrying, retry_if_exception_type, stop_after_attempt

from app import config

log = logging.getLogger("fetch_data")

BASE_URL = "https://data.elexon.co.uk/bmrs/api/v1"
USER_AGENT = "wind-forecast-monitor/0.1 (offline data pipeline)"
MAX_RETRY_AFTER_S = 60.0

Row = dict[str, Any]


class FetchError(RuntimeError):
    """A fetch failed in a way that retrying will not fix."""


class SchemaError(FetchError):
    """A response is missing fields we depend on (Elexon schema change, E-23)."""


class TransientError(FetchError):
    """A failure worth retrying: timeout, connection error, 5xx, 429 or empty body (E-22)."""

    def __init__(self, message: str, retry_after: float | None = None) -> None:
        super().__init__(message)
        self.retry_after = retry_after


class HttpSession(Protocol):
    headers: Any

    def get(self, url: str, *, params: dict[str, str], timeout: float) -> requests.Response: ...


@dataclass(frozen=True)
class Dataset:
    name: str
    path: str
    window: tuple[date, date]  # half-open [start, end)
    required_fields: tuple[str, ...]
    params: Callable[[date, date], dict[str, str]]  # chunk [start, end) -> query params


def _fuelhh_params(start: date, end: date) -> dict[str, str]:
    # Settlement-date bounds are inclusive on both ends.
    last = end - timedelta(days=1)
    return {
        "settlementDateFrom": start.isoformat(),
        "settlementDateTo": last.isoformat(),
        "fuelType": "WIND",
    }


def _windfor_params(start: date, end: date) -> dict[str, str]:
    # Publish-time bounds are inclusive on both ends, so stop one second before the next chunk.
    last = end - timedelta(days=1)
    return {
        "publishDateTimeFrom": f"{start.isoformat()}T00:00:00Z",
        "publishDateTimeTo": f"{last.isoformat()}T23:59:59Z",
    }


DATASETS: tuple[Dataset, ...] = (
    Dataset(
        name="fuelhh",
        path="/datasets/FUELHH/stream",
        window=config.FETCH_ACTUALS,
        required_fields=(
            "publishTime",
            "startTime",
            "settlementDate",
            "settlementPeriod",
            "fuelType",
            "generation",
        ),
        params=_fuelhh_params,
    ),
    Dataset(
        name="windfor",
        path="/datasets/WINDFOR/stream",
        window=config.FETCH_FORECASTS,
        required_fields=("publishTime", "startTime", "generation"),
        params=_windfor_params,
    ),
)


def date_chunks(start: date, end: date, days: int) -> list[tuple[date, date]]:
    """Split the half-open range [start, end) into consecutive half-open chunks of `days`."""
    chunks = []
    while start < end:
        stop = min(start + timedelta(days=days), end)
        chunks.append((start, stop))
        start = stop
    return chunks


def _retry_after(response: requests.Response) -> float | None:
    try:
        return min(float(response.headers["Retry-After"]), MAX_RETRY_AFTER_S)
    except (KeyError, ValueError):
        return None


def _get(session: HttpSession, url: str, params: dict[str, str]) -> bytes:
    """One GET. Raises TransientError for retryable failures and FetchError otherwise."""
    try:
        response = session.get(url, params=params, timeout=config.TIMEOUT_S)
    except (requests.Timeout, requests.ConnectionError) as exc:
        raise TransientError(f"{url} {params}: {type(exc).__name__}: {exc}") from exc
    status = response.status_code
    if status == 429:
        raise TransientError(f"{url} {params}: HTTP 429", retry_after=_retry_after(response))
    if status >= 500:
        raise TransientError(f"{url} {params}: HTTP {status}")
    if status != 200:
        raise FetchError(f"{url} {params}: HTTP {status}: {response.text[:300]}")
    if not response.content.strip():
        raise TransientError(f"{url} {params}: empty response body")
    return response.content


def _wait(state: RetryCallState) -> float:
    """Honour Retry-After on a 429, otherwise use the configured backoff for this retry."""
    exc = state.outcome.exception() if state.outcome else None
    if isinstance(exc, TransientError) and exc.retry_after is not None:
        return exc.retry_after
    return config.BACKOFF_S[min(state.attempt_number, len(config.BACKOFF_S)) - 1]


def _log_retry(state: RetryCallState) -> None:
    exc = state.outcome.exception() if state.outcome else None
    log.warning("retry attempt=%d reason=%s", state.attempt_number, exc)


def parse_rows(body: bytes, dataset: Dataset, url: str) -> list[Row]:
    """Parse and validate a response body: JSON list (or `data` key) with every required field."""
    try:
        payload = json.loads(body)
    except json.JSONDecodeError as exc:
        raise FetchError(f"{url}: response is not valid JSON") from exc
    rows = payload.get("data") if isinstance(payload, dict) else payload
    if not isinstance(rows, list):
        raise FetchError(f"{url}: expected a JSON list or an object with a 'data' list")
    if not rows:
        raise FetchError(f"{url}: no rows returned for this window")
    for i, row in enumerate(rows):
        if not isinstance(row, dict):
            raise SchemaError(f"{url}: row {i} is not a JSON object")
        missing = [field for field in dataset.required_fields if field not in row]
        if missing:
            raise SchemaError(
                f"{dataset.name}: row {i} is missing field(s) {', '.join(missing)} "
                f"(Elexon schema may have changed; see docs/data_notes.md)"
            )
    return rows


def request_rows(
    session: HttpSession,
    dataset: Dataset,
    params: dict[str, str],
    *,
    sleep: Callable[[float], None] = time.sleep,
) -> tuple[bytes, list[Row]]:
    """Fetch one chunk with retries; return the raw body and its validated rows."""
    url = f"{BASE_URL}{dataset.path}"
    retrying = Retrying(
        stop=stop_after_attempt(len(config.BACKOFF_S) + 1),
        wait=_wait,
        retry=retry_if_exception_type(TransientError),
        before_sleep=_log_retry,
        sleep=sleep,
        reraise=True,
    )
    body = retrying(_get, session, url, params)
    return body, parse_rows(body, dataset, url)


def _write_atomic(path: Path, data: bytes) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, path)


def summarise(path: Path, rows: list[Row], params: dict[str, str]) -> dict[str, Any]:
    # ISO-8601 UTC strings with a Z suffix sort chronologically.
    starts = [row["startTime"] for row in rows]
    publishes = [row["publishTime"] for row in rows]
    return {
        "file": path.name,
        "params": params,
        "rows": len(rows),
        "bytes": path.stat().st_size,
        "startTime": [min(starts), max(starts)],
        "publishTime": [min(publishes), max(publishes)],
    }


def fetch_dataset(
    dataset: Dataset,
    out_dir: Path,
    session: HttpSession,
    *,
    sleep: Callable[[float], None] = time.sleep,
) -> list[dict[str, Any]]:
    """Fetch every chunk of a dataset's window into out_dir; return one summary per file."""
    summaries = []
    for start, end in date_chunks(*dataset.window, config.FETCH_CHUNK_DAYS):
        params = dataset.params(start, end)
        body, rows = request_rows(session, dataset, params, sleep=sleep)
        path = out_dir / f"{dataset.name}_{start}_{end - timedelta(days=1)}.json"
        _write_atomic(path, body)
        summary = summarise(path, rows, params)
        log.info(
            "saved file=%s rows=%d startTime=%s..%s publishTime=%s..%s",
            path.name,
            summary["rows"],
            *summary["startTime"],
            *summary["publishTime"],
        )
        summaries.append(summary)
    return summaries


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    config.RAW_DIR.mkdir(parents=True, exist_ok=True)
    with requests.Session() as session:
        session.headers["User-Agent"] = USER_AGENT
        files = [s for ds in DATASETS for s in fetch_dataset(ds, config.RAW_DIR, session)]
    manifest = {"source": BASE_URL, "files": files}
    manifest_bytes = (json.dumps(manifest, indent=2) + "\n").encode()
    _write_atomic(config.RAW_DIR / "manifest.json", manifest_bytes)
    for ds in DATASETS:
        ds_files = [f for f in files if f["file"].startswith(f"{ds.name}_")]
        rows = sum(f["rows"] for f in ds_files)
        log.info("done dataset=%s files=%d rows=%d", ds.name, len(ds_files), rows)


if __name__ == "__main__":
    try:
        main()
    except FetchError as exc:
        log.error("fetch failed: %s", exc)
        raise SystemExit(1) from exc
