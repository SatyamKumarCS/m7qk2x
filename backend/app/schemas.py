"""Response models for the read-only API: exactly the keys in docs/spec.md §5.

`extra="forbid"` makes any drift between a builder and this contract fail loudly (a 500 in
tests) instead of silently changing what the frontend receives. Times are ISO-8601 UTC strings
with a Z suffix, power is MW rounded to 1 dp, and null means "no value".
"""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ErrorBody(Model):
    detail: str


class DataRange(Model):
    start: str
    end: str


class Health(Model):
    status: Literal["ok"]
    dataLoaded: bool
    actualsRows: int
    forecastRows: int
    dataRange: DataRange | None


class Scope(Model):
    deliveryStart: str
    deliveryEnd: str


class Preset(Model):
    label: str
    value: str


class Source(Model):
    name: str
    url: str


class Meta(Model):
    scope: Scope
    defaultCutoff: str
    cutoffPresets: list[Preset]
    publishSchedule: list[str]
    forecastResolutionMinutes: int
    assumptions: list[str]
    quality: dict[str, Any]  # quality_report.json, docs/spec.md §3
    sources: list[Source]
    version: str


class Counts(Model):
    n: int
    missingForecast: int
    missingActual: int


class Echo(Model):
    """Request parameters echoed back with every range response."""

    start: str
    end: str
    cutoff: str | None
    timezone: str


class TimeseriesPoint(Model):
    startTime: str
    actual: float | None
    forecast: float | None
    publishTime: str | None
    horizonHours: float | None
    error: float | None
    evaluated: bool


class Timeseries(Echo):
    points: list[TimeseriesPoint]
    counts: Counts


class MetricBlock(Model):
    mae: float | None
    rmse: float | None
    bias: float | None
    medianAbs: float | None
    p90Abs: float | None
    p95Abs: float | None
    maxAbs: float | None
    nmae: float | None  # percent
    wape: float | None  # percent
    mapeAbove1GW: float | None  # percent
    r: float | None


class Metrics(Echo):
    metrics: MetricBlock
    counts: Counts


class Group(Model):
    group: str
    n: int
    mae: float | None
    rmse: float | None
    bias: float | None
    p90: float | None
    lowSample: bool


class Breakdown(Echo):
    by: Literal["horizon", "hour", "level", "day"]
    groups: list[Group]
    note: str | None


class Calibration(Model):
    start: str
    end: str
    n: int
    method: Literal["empirical-type7-global"]
    inSampleCoverage: float | None
    heldOutCoverage: float | None


class BandPoint(Model):
    startTime: str
    forecast: float | None
    lower: float | None
    upper: float | None
    actual: float | None
    inside: bool | None


class Coverage(Model):
    inside: int
    below: int
    above: int
    valid: int
    coverage: float | None


class EnergyComparison(Model):
    hours: int
    forecastMwh: float
    actualMwh: float
    errorPct: float | None


class Notes(Model):
    scope: str
    bias: str


class ContainsForecast(Model):
    points: int
    contained: int
    all: bool


class DaySummary(Model):
    date: str | None
    points: int
    validPairs: int
    maeMw: float | None
    biasMw: float | None
    forecastMwh: float | None
    forecastHours: int
    actualMwh: float | None
    actualHours: int
    energyComparison: EnergyComparison | None
    coverage: Coverage | None
    coverageReason: str | None
    notes: Notes
    containsForecast: ContainsForecast | None


class Band(Model):
    date: str
    cutoff: str
    level: int
    timezone: str
    qLo: float | None
    qHi: float | None
    calibration: Calibration
    points: list[BandPoint]
    summary: DaySummary
    reason: str | None
