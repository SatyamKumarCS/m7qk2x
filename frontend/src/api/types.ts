// Response shapes for the read-only API. Mirrors docs/spec.md §5 (and §3 for the quality
// report): camelCase keys, ISO-8601 UTC times, MW rounded to 1 dp, null for missing values.

import type { BandLevel } from '../constants.ts'

export type IsoUtc = string // e.g. "2026-01-15T00:00:00Z"
export type IsoDate = string // e.g. "2026-01-15"

export interface Counts {
  n: number
  missingForecast: number
  missingActual: number
}

export interface HealthResponse {
  status: 'ok'
  dataLoaded: boolean
  actualsRows: number
  forecastRows: number
  dataRange: { start: IsoDate; end: IsoDate }
}

export interface QualityReport {
  inputs: { file: string; sha256: string }[]
  actuals: {
    rows: number
    expected: number
    missingSlots: IsoUtc[]
    duplicates: number
    revisionsCollapsed: number
    nonWindDropped: number
    nulls: number
    negatives: number
    spikes: number
    spikeTimes: IsoUtc[]
    startTimeRange: [IsoUtc, IsoUtc]
    generationRangeMw: [number, number]
    resolutionMinutes: number
  }
  forecasts: {
    rows: number
    runs: number
    runsPerPublishDay: Record<string, number>
    publishClockTimes: Record<string, number>
    duplicates: number
    conflictingDuplicates: number
    droppedPublishedAfterTarget: number
    nulls: number
    negatives: number
    spikes: number
    spikeTimes: IsoUtc[]
    publishTimeRange: [IsoUtc, IsoUtc]
    startTimeRange: [IsoUtc, IsoUtc]
    horizonRangeH: [number, number]
    generationRangeMw: [number, number]
    resolutionMinutes: number
  }
}

export interface MetaResponse {
  scope: { deliveryStart: IsoDate; deliveryEnd: IsoDate }
  defaultCutoff: string
  cutoffPresets: { label: string; value: string }[]
  publishSchedule: string[]
  forecastResolutionMinutes: number
  assumptions: string[]
  quality: QualityReport
  sources: { name: string; url: string }[]
  version: string
}

export interface TimeseriesPoint {
  startTime: IsoUtc
  actual: number | null
  forecast: number | null
  publishTime: IsoUtc | null
  horizonHours: number | null
  error: number | null
  evaluated: boolean
}

export interface TimeseriesResponse {
  points: TimeseriesPoint[]
  counts: Counts
}

export interface MetricsResponse {
  metrics: {
    mae: number | null
    rmse: number | null
    bias: number | null
    medianAbs: number | null
    p90Abs: number | null
    p95Abs: number | null
    maxAbs: number | null
    nmae: number | null // percent
    wape: number | null // percent
    mapeAbove1GW: number | null // percent
    r: number | null
  }
  counts: Counts
}

export type BreakdownBy = 'horizon' | 'hour' | 'level' | 'day'

export interface BreakdownGroup {
  group: string
  n: number
  mae: number | null
  rmse: number | null
  bias: number | null
  p90: number | null
  lowSample: boolean
}

export interface BreakdownResponse {
  by: BreakdownBy
  groups: BreakdownGroup[]
  note: string | null
}

export interface Coverage {
  inside: number
  below: number
  above: number
  valid: number
  coverage: number | null
}

export interface DaySummary {
  date: IsoDate | null
  points: number
  validPairs: number
  maeMw: number | null
  biasMw: number | null
  forecastMwh: number | null
  forecastHours: number
  actualMwh: number | null
  actualHours: number
  energyComparison: {
    hours: number
    forecastMwh: number
    actualMwh: number
    errorPct: number | null
  } | null
  coverage: Coverage | null
  coverageReason: string | null
  notes: { scope: string; bias: string }
}

export interface BandPoint {
  startTime: IsoUtc
  forecast: number | null
  lower: number | null
  upper: number | null
  actual: number | null
  inside: boolean | null
}

export interface BandResponse {
  level: BandLevel
  qLo: number | null
  qHi: number | null
  calibration: {
    start: IsoDate
    end: IsoDate
    n: number
    method: 'empirical-type7-global'
    inSampleCoverage: number | null
    heldOutCoverage: number | null
  }
  points: BandPoint[]
  summary: DaySummary & { containsForecast: { points: number; contained: number; all: boolean } }
  reason?: string | null
}

/** Common query parameters (spec §5): inclusive delivery dates and a UK cutoff clock. */
export interface RangeQuery {
  start: IsoDate
  end: IsoDate
  cutoff: string
}
