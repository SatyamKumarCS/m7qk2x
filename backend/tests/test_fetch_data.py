import json
from dataclasses import replace
from datetime import date
from pathlib import Path
from typing import Any

import pytest
import requests

from app import config
from scripts import fetch_data
from scripts.fetch_data import (
    DATASETS,
    FetchError,
    SchemaError,
    TransientError,
    date_chunks,
    fetch_dataset,
    request_rows,
)

FUELHH, WINDFOR = DATASETS
WINDFOR_ROWS = [
    {
        "dataset": "WINDFOR",
        "publishTime": "2026-01-14T07:30:00Z",
        "startTime": "2026-01-15T00:00:00Z",
        "generation": 12010,
    }
]
WINDFOR_BODY = json.dumps(WINDFOR_ROWS).encode()
PARAMS = {"publishDateTimeFrom": "2026-01-14T00:00:00Z"}


def response(
    status: int, body: bytes = WINDFOR_BODY, headers: dict[str, str] | None = None
) -> requests.Response:
    r = requests.Response()
    r.status_code = status
    r._content = body
    r.encoding = "utf-8"
    r.headers.update(headers or {})
    return r


class FakeSession:
    """Replays scripted outcomes (a Response or an exception to raise) and records each call."""

    def __init__(self, *outcomes: requests.Response | Exception) -> None:
        self.outcomes = list(outcomes)
        self.calls: list[dict[str, Any]] = []
        self.headers: dict[str, str] = {}

    def get(self, url: str, *, params: dict[str, str], timeout: float) -> requests.Response:
        self.calls.append({"url": url, "params": params, "timeout": timeout})
        outcome = self.outcomes.pop(0) if len(self.outcomes) > 1 else self.outcomes[0]
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    def __enter__(self) -> "FakeSession":
        return self

    def __exit__(self, *exc: object) -> None:
        return None


def fetch(session: FakeSession) -> tuple[bytes, list[dict[str, Any]], list[float]]:
    waits: list[float] = []
    body, rows = request_rows(session, WINDFOR, PARAMS, sleep=waits.append)
    return body, rows, waits


# --- windows, chunks and params -------------------------------------------------------


def test_fetch_windows_match_prd_and_cover_buffer_days() -> None:
    # PRD §4.2: delivery days 2 Jan–1 Feb need a day of actuals buffer and ~3 days of earlier runs.
    assert (date(2026, 1, 1), date(2026, 2, 2)) == config.FETCH_ACTUALS
    assert (date(2025, 12, 29), date(2026, 2, 1)) == config.FETCH_FORECASTS


def test_date_chunks_cover_window_without_gaps_or_overlap() -> None:
    chunks = date_chunks(date(2026, 1, 1), date(2026, 2, 2), 7)

    assert chunks[0][0] == date(2026, 1, 1) and chunks[-1][1] == date(2026, 2, 2)
    assert all(a[1] == b[0] for a, b in zip(chunks, chunks[1:], strict=False))
    assert [(end - start).days for start, end in chunks] == [7, 7, 7, 7, 4]


def test_params_use_verified_inclusive_bounds() -> None:
    assert FUELHH.params(date(2026, 1, 1), date(2026, 1, 8)) == {
        "settlementDateFrom": "2026-01-01",
        "settlementDateTo": "2026-01-07",
        "fuelType": "WIND",
    }
    assert WINDFOR.params(date(2026, 1, 1), date(2026, 1, 8)) == {
        "publishDateTimeFrom": "2026-01-01T00:00:00Z",
        "publishDateTimeTo": "2026-01-07T23:59:59Z",
    }


# --- retries (E-22) ---------------------------------------------------------------------


def test_timeout_is_retried_then_succeeds() -> None:
    session = FakeSession(requests.Timeout("read timed out"), response(200))

    body, rows, waits = fetch(session)

    assert body == WINDFOR_BODY and rows == WINDFOR_ROWS
    assert waits == [2] and len(session.calls) == 2
    assert session.calls[0]["timeout"] == config.TIMEOUT_S


def test_5xx_is_retried_with_configured_backoff() -> None:
    session = FakeSession(response(503), response(502), response(200))

    _, _, waits = fetch(session)

    assert waits == [2, 4] and len(session.calls) == 3


def test_429_waits_for_retry_after_header() -> None:
    session = FakeSession(response(429, headers={"Retry-After": "7"}), response(200))

    _, _, waits = fetch(session)

    assert waits == [7]


def test_429_without_header_uses_backoff() -> None:
    _, _, waits = fetch(FakeSession(response(429), response(200)))

    assert waits == [2]


def test_persistent_5xx_fails_loudly_after_all_retries() -> None:
    session = FakeSession(response(503))
    waits: list[float] = []

    with pytest.raises(TransientError, match="HTTP 503"):
        request_rows(session, WINDFOR, PARAMS, sleep=waits.append)

    assert waits == [2, 4, 8] and len(session.calls) == 4


def test_empty_body_fails_loudly_after_retries() -> None:
    session = FakeSession(response(200, body=b""))

    with pytest.raises(TransientError, match="empty response body"):
        request_rows(session, WINDFOR, PARAMS, sleep=lambda _: None)

    assert len(session.calls) == 4


def test_client_error_is_not_retried() -> None:
    problem = b'{"title":"One or more validation errors occurred.","status":400}'
    session = FakeSession(response(400, body=problem))

    with pytest.raises(FetchError, match="HTTP 400.*validation errors"):
        request_rows(session, WINDFOR, PARAMS, sleep=lambda _: pytest.fail("must not retry"))

    assert len(session.calls) == 1


# --- validation (E-23) ------------------------------------------------------------------


def test_missing_field_raises_error_naming_the_field() -> None:
    row = {"publishTime": "2026-01-14T07:30:00Z", "startTime": "2026-01-15T00:00:00Z"}
    body = json.dumps([row])

    with pytest.raises(SchemaError, match="missing field\\(s\\) generation"):
        fetch(FakeSession(response(200, body=body.encode())))


def test_empty_row_list_fails() -> None:
    with pytest.raises(FetchError, match="no rows"):
        fetch(FakeSession(response(200, body=b"[]")))


def test_non_json_body_fails() -> None:
    with pytest.raises(FetchError, match="not valid JSON"):
        fetch(FakeSession(response(200, body=b"<html>maintenance</html>")))


def test_data_key_shape_is_accepted() -> None:
    body = json.dumps({"data": WINDFOR_ROWS}).encode()

    _, rows, _ = fetch(FakeSession(response(200, body=body)))

    assert rows == WINDFOR_ROWS


# --- files ------------------------------------------------------------------------------


def test_fetch_dataset_saves_raw_bytes_and_is_idempotent(tmp_path: Path) -> None:
    dataset = replace(WINDFOR, window=(date(2026, 1, 1), date(2026, 1, 10)))

    for _ in range(2):
        session = FakeSession(response(200))
        summaries = fetch_dataset(dataset, tmp_path, session, sleep=lambda _: None)

    names = sorted(p.name for p in tmp_path.iterdir())
    assert names == ["windfor_2026-01-01_2026-01-07.json", "windfor_2026-01-08_2026-01-09.json"]
    assert all((tmp_path / n).read_bytes() == WINDFOR_BODY for n in names)
    assert summaries[0]["rows"] == 1
    assert summaries[0]["startTime"] == ["2026-01-15T00:00:00Z", "2026-01-15T00:00:00Z"]


def test_main_sets_user_agent_and_writes_manifest(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    fuelhh_row = {
        "publishTime": "2026-01-01T00:30:00Z",
        "startTime": "2026-01-01T00:00:00Z",
        "settlementDate": "2026-01-01",
        "settlementPeriod": 1,
        "fuelType": "WIND",
        "generation": 9000,
    }
    session = FakeSession(response(200, body=json.dumps([fuelhh_row | WINDFOR_ROWS[0]]).encode()))
    monkeypatch.setattr(fetch_data.requests, "Session", lambda: session)
    monkeypatch.setattr(config, "RAW_DIR", tmp_path)

    fetch_data.main()

    assert session.headers["User-Agent"] == fetch_data.USER_AGENT
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    assert [f["file"].split("_")[0] for f in manifest["files"]] == ["fuelhh"] * 5 + ["windfor"] * 5
