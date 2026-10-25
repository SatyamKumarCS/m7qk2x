from fastapi.testclient import TestClient

from app.main import app


def test_health_stub_reports_no_data_loaded() -> None:
    response = TestClient(app).get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "dataLoaded": False}
