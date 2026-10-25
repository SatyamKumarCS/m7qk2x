"""API input validation, routing rules, CORS, logging and data-unavailable handling."""

import logging
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import config, data_store, service
from app.main import app


@pytest.fixture(scope="module")
def client() -> Iterator[TestClient]:
    with TestClient(app) as c:
        yield c


@pytest.mark.parametrize(
    ("url", "fragment"),
    [
        (
            "/api/metrics?start=2026-01-20&end=2026-01-10",
            "start (2026-01-20) must be on or before end",
        ),
        ("/api/metrics?start=2026-1-5", "start must be a date written as YYYY-MM-DD"),
        ("/api/metrics?end=2026-02-30", "end must be a date written as YYYY-MM-DD"),
        ("/api/metrics?start=2025-12-31", "outside the data scope (2026-01-02 to 2026-02-01)"),
        ("/api/timeseries?cutoff=25:00", "cutoff must be HH:MM between 00:00 and 23:59"),
        ("/api/timeseries?cutoff=9:20", "cutoff must be HH:MM"),
        ("/api/breakdown?by=week", "by: Input should be 'horizon', 'hour', 'level' or 'day'"),
        ("/api/breakdown", "by: Field required"),
        ("/api/band?date=2026-01-15&level=70", "level must be 80 or 90, got 70"),
        ("/api/band?date=2026-01-15&level=abc", "level:"),
        ("/api/band", "date: Field required"),
        ("/api/band?date=2026-03-01", "date 2026-03-01 is outside the data scope"),
    ],
)
def test_invalid_input_returns_422_with_readable_detail(
    client: TestClient, url: str, fragment: str
) -> None:
    response = client.get(url)

    assert response.status_code == 422
    assert set(response.json()) == {"detail"} and isinstance(response.json()["detail"], str)
    assert fragment in response.json()["detail"]


def test_only_get_routes_and_docs_list_every_endpoint(client: TestClient) -> None:
    api_routes = [r for r in app.routes if getattr(r, "path", "").startswith("/api")]

    assert {m for r in api_routes for m in r.methods} <= {"GET", "HEAD"}
    assert client.post("/api/metrics").status_code == 405
    paths = set(client.get("/openapi.json").json()["paths"])
    assert paths == {
        "/api/health",
        "/api/meta",
        "/api/timeseries",
        "/api/metrics",
        "/api/breakdown",
        "/api/band",
    }
    assert client.get("/docs").status_code == 200


def test_cors_allows_only_configured_origins(client: TestClient) -> None:
    allowed = client.get("/api/health", headers={"Origin": "http://localhost:5173"})
    other = client.get("/api/health", headers={"Origin": "https://evil.example"})

    assert allowed.headers.get("access-control-allow-origin") == "http://localhost:5173"
    assert "access-control-allow-origin" not in other.headers
    assert config.CORS_ORIGINS == ["http://localhost:5173"]


def test_each_request_logs_one_structured_line(
    client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.INFO, logger="api"):
        client.get("/api/metrics?cutoff=09:50")

    lines = [r.getMessage() for r in caplog.records if r.getMessage().startswith("request ")]
    assert len(lines) == 1
    assert "path=/api/metrics" in lines[0] and "status=200" in lines[0] and "ms=" in lines[0]
    assert "'cutoff': '09:50'" in lines[0] and "rows=744" in lines[0]


def test_missing_data_reports_health_and_503(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(config, "PROCESSED_DIR", tmp_path)  # empty folder: no parquet files
    data_store.get_store.cache_clear()
    service.reset_caches()
    try:
        with TestClient(app) as c:
            health = c.get("/api/health").json()
            metrics = c.get("/api/metrics")
        assert health["dataLoaded"] is False and health["dataRange"] is None
        assert metrics.status_code == 503 and metrics.json() == {
            "detail": "Data is not available right now."
        }
    finally:
        monkeypatch.undo()
        data_store.get_store.cache_clear()
        service.reset_caches()
