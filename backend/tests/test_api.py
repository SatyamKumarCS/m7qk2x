"""API contract tests: PRD §11.3 and docs/spec.md §5 (exact keys, values, invariant, speed)."""

import time
from collections.abc import Iterator
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient

from app import config
from app.main import app

ECHO = {"start", "end", "cutoff", "timezone"}
COUNTS = {"n", "missingForecast", "missingActual"}
POINT = {"startTime", "actual", "forecast", "publishTime", "horizonHours", "error", "evaluated"}
METRICS = {
    "mae",
    "rmse",
    "bias",
    "medianAbs",
    "p90Abs",
    "p95Abs",
    "maxAbs",
    "nmae",
    "wape",
    "mapeAbove1GW",
    "r",
}
GROUP = {"group", "n", "mae", "rmse", "bias", "p90", "lowSample"}
SUMMARY = {
    "date",
    "points",
    "validPairs",
    "maeMw",
    "biasMw",
    "forecastMwh",
    "forecastHours",
    "actualMwh",
    "actualHours",
    "energyComparison",
    "coverage",
    "coverageReason",
    "notes",
    "containsForecast",
}


@pytest.fixture(scope="module")
def client() -> Iterator[TestClient]:
    with TestClient(app) as c:
        yield c


def get(client: TestClient, url: str) -> dict:
    response = client.get(url)
    assert response.status_code == 200, response.text
    return response.json()


# --- PRD §11.3 ----------------------------------------------------------------------------


def test_health_returns_row_counts(client: TestClient) -> None:
    body = get(client, "/api/health")

    assert set(body) == {"status", "dataLoaded", "actualsRows", "forecastRows", "dataRange"}
    assert (
        body["dataLoaded"] is True and body["actualsRows"] == 1536 and body["forecastRows"] == 15775
    )
    assert body["dataRange"] == {"start": "2026-01-01", "end": "2026-02-01"}


def test_timeseries_one_day_has_documented_keys(client: TestClient) -> None:
    body = get(client, "/api/timeseries?start=2026-01-15&end=2026-01-15&cutoff=09:20")

    assert set(body) == ECHO | {"points", "counts"}
    assert body["timezone"] == "Europe/London" and body["cutoff"] == "09:20"
    assert len(body["points"]) == 48 and all(set(p) == POINT for p in body["points"])
    evaluated = [p for p in body["points"] if p["evaluated"]]
    assert len(evaluated) == 24 and body["counts"] == {
        "n": 24,
        "missingForecast": 0,
        "missingActual": 0,
    }
    first = evaluated[0]
    assert (
        first["startTime"] == "2026-01-15T00:00:00Z"
        and first["publishTime"] == "2026-01-14T07:30:00Z"
    )
    assert first["horizonHours"] == 16.5
    assert first["error"] == pytest.approx(first["forecast"] - first["actual"], abs=0.11)
    half_hour = body["points"][1]
    assert (
        not half_hour["evaluated"]
        and half_hour["forecast"] is None
        and half_hour["actual"] is not None
    )


@pytest.mark.parametrize("cutoff", sorted(set(config.CUTOFF_PRESETS.values())))
def test_no_point_was_published_after_its_cutoff(client: TestClient, cutoff: str) -> None:
    """Independent check of ADR 0002 on the full scope, using zoneinfo rather than app.selection."""
    hour, minute = map(int, cutoff.split(":"))
    uk = ZoneInfo("Europe/London")
    points = [
        p for p in get(client, f"/api/timeseries?cutoff={cutoff}")["points"] if p["publishTime"]
    ]

    assert len(points) == 744
    for p in points:
        start = datetime.fromisoformat(p["startTime"])
        decision_day = start.astimezone(uk).date() - timedelta(days=1)
        limit = datetime(
            decision_day.year, decision_day.month, decision_day.day, hour, minute, tzinfo=uk
        )
        assert datetime.fromisoformat(p["publishTime"]) <= limit, p


# --- exact keys and values per endpoint ---------------------------------------------------


def test_meta_contract(client: TestClient) -> None:
    body = get(client, "/api/meta")

    assert set(body) == {
        "scope",
        "defaultCutoff",
        "cutoffPresets",
        "publishSchedule",
        "forecastResolutionMinutes",
        "assumptions",
        "quality",
        "sources",
        "version",
    }
    assert body["scope"] == {"deliveryStart": "2026-01-02", "deliveryEnd": "2026-02-01"}
    assert body["cutoffPresets"] == [
        {"label": k, "value": v} for k, v in config.CUTOFF_PRESETS.items()
    ]
    assert body["publishSchedule"] == [
        "02:30",
        "04:30",
        "07:30",
        "09:30",
        "11:30",
        "15:30",
        "18:30",
        "22:30",
    ]
    assert body["forecastResolutionMinutes"] == 60 and body["assumptions"]
    assert set(body["quality"]) == {"inputs", "actuals", "forecasts"}


def test_metrics_contract_and_values(client: TestClient) -> None:
    body = get(client, "/api/metrics")

    assert set(body) == ECHO | {"metrics", "counts"} and set(body["metrics"]) == METRICS
    assert (body["start"], body["end"]) == (
        "2026-01-02",
        "2026-02-01",
    )  # default: whole scope (A-12)
    assert body["metrics"]["mae"] == 2022.5 and body["metrics"]["bias"] == 1745.9
    assert body["counts"] == {"n": 744, "missingForecast": 0, "missingActual": 0}


@pytest.mark.parametrize(
    ("by", "groups"), [("hour", 24), ("level", 4), ("day", 31), ("horizon", 6)]
)
def test_breakdown_contract(client: TestClient, by: str, groups: int) -> None:
    body = get(client, f"/api/breakdown?by={by}")

    assert set(body) == ECHO | {"by", "groups", "note"} and body["by"] == by
    assert len(body["groups"]) == groups and all(set(g) == GROUP for g in body["groups"])
    if by == "horizon":
        assert body["cutoff"] is None and "[48,72)" in body["note"] and "19 of 24" in body["note"]
        assert [g["group"] for g in body["groups"]][-1] == "[48,72)"
    else:
        assert body["note"] is None


def test_band_contract_and_values(client: TestClient) -> None:
    body = get(client, "/api/band?date=2026-01-15&cutoff=09:20")

    assert set(body) == {
        "date",
        "cutoff",
        "level",
        "timezone",
        "qLo",
        "qHi",
        "calibration",
        "points",
        "summary",
        "reason",
    }
    assert (body["level"], body["qLo"], body["qHi"], body["reason"]) == (80, -426.4, 4154.4, None)
    assert body["calibration"] == {
        "start": "2026-01-02",
        "end": "2026-02-01",
        "n": 744,
        "method": "empirical-type7-global",
        "inSampleCoverage": 0.7984,
        "heldOutCoverage": 0.7844,
    }
    assert len(body["points"]) == 24 and all(
        p["lower"] <= p["upper"] and p["lower"] >= 0 for p in body["points"]
    )
    assert set(body["summary"]) == SUMMARY
    assert body["summary"]["coverage"]["valid"] == 24
    assert body["summary"]["containsForecast"] == {"points": 24, "contained": 24, "all": True}
    assert body["summary"]["notes"]["scope"].startswith("Operationally metered")


def test_band_90_and_custom_cutoff(client: TestClient) -> None:
    body = get(client, "/api/band?date=2026-01-15&level=90&cutoff=09:50")

    assert (body["level"], body["cutoff"]) == (90, "09:50")
    assert body["calibration"]["heldOutCoverage"] == 0.8786  # notebook 02: 0.879 (3 dp)


def test_custom_cutoff_is_accepted(client: TestClient) -> None:
    body = get(client, "/api/timeseries?start=2026-01-15&end=2026-01-15&cutoff=08:15")

    assert body["cutoff"] == "08:15"
    assert {p["publishTime"] for p in body["points"] if p["evaluated"]} == {"2026-01-14T07:30:00Z"}


# --- speed (NFR: warm full-month request < 300 ms) -----------------------------------------


def test_warm_full_month_timeseries_is_fast(client: TestClient) -> None:
    url = "/api/timeseries?start=2026-01-02&end=2026-02-01&cutoff=09:20"
    client.get(url)  # warm the cache
    timings = []
    for _ in range(5):
        started = time.perf_counter()
        assert client.get(url).status_code == 200
        timings.append(time.perf_counter() - started)

    assert max(timings) < 0.3, timings
