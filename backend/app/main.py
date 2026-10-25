"""FastAPI application: read-only API over the processed data (docs/spec.md §5).

`app` lives at app/main.py, which is the entrypoint Vercel's FastAPI support detects.
"""

import logging
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app import config
from app.data_store import DataUnavailable, try_store
from app.routes import router
from app.service import InvariantError

if not logging.getLogger().handlers:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("api")


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    try_store()  # warm the data once; requests load it lazily if the host skips lifespan
    yield


app = FastAPI(
    title="Wind Forecast Monitor API",
    version=config.API_VERSION,
    description=(
        "Read-only API: the GB wind forecast available at the day-ahead cutoff, compared with "
        "metered outturn, for delivery days 2 Jan – 1 Feb 2026. Times are UTC; cutoffs are UK time."
    ),
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.middleware("http")
async def log_requests(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    """One structured line per request: method, path, params, status, ms, rows (NFR)."""
    started = time.perf_counter()
    response = await call_next(request)
    log.info(
        "request method=%s path=%s params=%s status=%d ms=%.1f rows=%s",
        request.method,
        request.url.path,
        dict(request.query_params),
        response.status_code,
        (time.perf_counter() - started) * 1000,
        getattr(request.state, "rows", "-"),
    )
    return response


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    """Flatten FastAPI/Pydantic errors into the API's single `{"detail": str}` shape (E-20)."""
    parts = []
    for error in exc.errors():
        name = error["loc"][-1] if error.get("loc") else "request"
        parts.append(f"{name}: {error['msg']}")
    return JSONResponse(status_code=422, content={"detail": "; ".join(parts) or "Invalid request."})


@app.exception_handler(DataUnavailable)
async def data_unavailable(_: Request, exc: DataUnavailable) -> JSONResponse:
    log.error("%s", exc)
    return JSONResponse(status_code=503, content={"detail": "Data is not available right now."})


@app.exception_handler(InvariantError)
async def invariant_breach(_: Request, exc: InvariantError) -> JSONResponse:
    return JSONResponse(status_code=500, content={"detail": str(exc)})


app.include_router(router)
