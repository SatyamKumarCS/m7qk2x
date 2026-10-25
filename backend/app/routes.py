"""Read-only API routes (docs/spec.md §5; PRD FR-2.1–2.8). Every route is GET.

Parameters are validated here with plain-English 422 messages (E-20, E-21); the work is done by
the cached builders in app.service.
"""

from dataclasses import dataclass
from datetime import date
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app import config, service
from app.data_store import try_store
from app.schemas import Band, Breakdown, ErrorBody, Health, Meta, Metrics, Timeseries
from app.selection import parse_cutoff_clock

router = APIRouter(prefix="/api")
ERRORS: dict[int | str, dict[str, Any]] = {
    422: {"model": ErrorBody, "description": "Invalid or out-of-scope parameter"},
    503: {"model": ErrorBody, "description": "Processed data could not be loaded"},
}
SCOPE_TEXT = f"{config.DELIVERY_START.isoformat()} to {config.DELIVERY_END.isoformat()}"

DateParam = Query(
    description=f"Delivery day, YYYY-MM-DD (UK calendar day), within {SCOPE_TEXT}.",
    examples=["2026-01-15"],
)
CutoffParam = Query(
    description="Decision cutoff, HH:MM UK time on the day before delivery (24 h, zero-padded).",
    examples=["09:20"],
)


def _unprocessable(message: str) -> HTTPException:
    return HTTPException(status_code=422, detail=message)


def _day(name: str, value: str) -> date:
    try:
        parsed = date.fromisoformat(value) if len(value) == 10 else None
    except ValueError:
        parsed = None
    if parsed is None:
        raise _unprocessable(f"{name} must be a date written as YYYY-MM-DD, got {value!r}.")
    if not config.DELIVERY_START <= parsed <= config.DELIVERY_END:
        raise _unprocessable(f"{name} {value} is outside the data scope ({SCOPE_TEXT}).")
    return parsed


def _cutoff(value: str) -> str:
    try:
        return parse_cutoff_clock(value).strftime("%H:%M")
    except ValueError:
        raise _unprocessable(
            f"cutoff must be HH:MM between 00:00 and 23:59 (UK time), got {value!r}."
        ) from None


@dataclass(frozen=True)
class Range:
    start: date
    end: date
    cutoff: str


def range_query(
    start: Annotated[str | None, DateParam] = None,
    end: Annotated[str | None, DateParam] = None,
    cutoff: Annotated[str, CutoffParam] = config.DEFAULT_CUTOFF,
) -> Range:
    """Common parameters: inclusive delivery-day range (default: whole scope) and cutoff."""
    first = _day("start", start) if start is not None else config.DELIVERY_START
    last = _day("end", end) if end is not None else config.DELIVERY_END
    if first > last:
        raise _unprocessable(f"start ({first}) must be on or before end ({last}).")
    return Range(first, last, _cutoff(cutoff))


RangeDep = Annotated[Range, Depends(range_query)]


@router.get("/health", response_model=Health, summary="Liveness and data status")
def get_health() -> dict[str, Any]:
    store = try_store()
    if store is None:
        return {
            "status": "ok",
            "dataLoaded": False,
            "actualsRows": 0,
            "forecastRows": 0,
            "dataRange": None,
        }
    uk_days = store.actuals["start_time"].dt.tz_convert(config.TZ).dt.date
    return {
        "status": "ok",
        "dataLoaded": True,
        "actualsRows": len(store.actuals),
        "forecastRows": len(store.forecasts),
        "dataRange": {"start": uk_days.min().isoformat(), "end": uk_days.max().isoformat()},
    }


@router.get(
    "/meta",
    response_model=Meta,
    responses=ERRORS,
    summary="Scope, presets, assumptions and data quality",
)
def get_meta() -> dict[str, Any]:
    return service.meta()


@router.get(
    "/timeseries",
    response_model=Timeseries,
    responses=ERRORS,
    summary="Forecast vs actual per half-hour",
)
def get_timeseries(q: RangeDep, request: Request) -> dict[str, Any]:
    body = service.timeseries(q.start, q.end, q.cutoff)
    request.state.rows = len(body["points"])
    return body


@router.get("/metrics", response_model=Metrics, responses=ERRORS, summary="Headline error metrics")
def get_metrics(q: RangeDep, request: Request) -> dict[str, Any]:
    body = service.metrics(q.start, q.end, q.cutoff)
    request.state.rows = body["counts"]["n"]
    return body


@router.get(
    "/breakdown",
    response_model=Breakdown,
    responses=ERRORS,
    summary="Error by horizon, hour, level or day",
)
def get_breakdown(
    q: RangeDep,
    request: Request,
    by: Annotated[
        Literal["horizon", "hour", "level", "day"],
        Query(description="Grouping. `horizon` uses every forecast run and ignores `cutoff`."),
    ],
) -> dict[str, Any]:
    body = service.breakdowns(by, q.start, q.end, q.cutoff)
    request.state.rows = len(body["groups"])
    return body


@router.get(
    "/band", response_model=Band, responses=ERRORS, summary="Planning band for one delivery day"
)
def get_band(
    request: Request,
    date_: Annotated[
        str, Query(alias="date", description=DateParam.description, examples=["2026-01-15"])
    ],
    cutoff: Annotated[str, CutoffParam] = config.DEFAULT_CUTOFF,
    level: Annotated[
        int, Query(description="Band level in percent: 80 (default) or 90.")
    ] = config.BAND_DEFAULT_LEVEL,
) -> dict[str, Any]:
    if level not in config.BAND_QUANTILES:
        raise _unprocessable(f"level must be 80 or 90, got {level}.")
    body = service.band_day(_day("date", date_), _cutoff(cutoff), level)
    request.state.rows = len(body["points"])
    return body
