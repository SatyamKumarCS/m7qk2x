"""FastAPI entry point.

Scaffold stub: the data store, routes and validation arrive with the Backend API ticket.
"""

from fastapi import FastAPI

app = FastAPI(title="Wind Forecast Monitor API", version="0.1.0")


@app.get("/api/health")
def health() -> dict[str, object]:
    """Liveness check. Reports that no data is loaded yet."""
    return {"status": "ok", "dataLoaded": False}
