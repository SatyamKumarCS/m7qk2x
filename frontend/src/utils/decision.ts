// Pure derivations for the Decision view (PRD FR-3.1–3.4, ADR 0009). Missing values stay null
// everywhere: they make gaps in the chart and are skipped in peaks, never counted as zero.

import type { BandResponse, TimeseriesResponse } from '../api/types.ts'
import { formatPower, formatShare, formatSignedPower } from './format.ts'

export interface ForecastRow {
  t: number // epoch ms of the hour start
  forecast: number | null
  band: [number, number] | null // [lower, upper] in MW; null where there is no band
}

export interface ActualRow {
  t: number // epoch ms of the half-hour start
  actual: number | null
}

export interface Extreme {
  mw: number
  at: string // ISO UTC
}

export interface DayKpis {
  peak: Extreme | null
  trough: Extreme | null
  publishTimes: string[] // distinct runs used (normally one), ISO UTC, sorted
  horizon: [number, number] | null // hours ahead, min and max
}

/** Hourly forecast and band rows (band endpoint) and half-hourly actual rows (timeseries). */
export function buildSeries(band: BandResponse, series: TimeseriesResponse) {
  const forecast: ForecastRow[] = band.points.map((p) => ({
    t: Date.parse(p.startTime),
    forecast: p.forecast,
    band: p.lower !== null && p.upper !== null ? [p.lower, p.upper] : null,
  }))
  const actual: ActualRow[] = series.points.map((p) => ({
    t: Date.parse(p.startTime),
    actual: p.actual,
  }))
  return { forecast, actual }
}

export function dayKpis(band: BandResponse, series: TimeseriesResponse): DayKpis {
  const withForecast = band.points.filter((p) => p.forecast !== null)
  const pick = (better: (a: number, b: number) => boolean): Extreme | null =>
    withForecast.reduce<Extreme | null>(
      (best, p) =>
        best === null || better(p.forecast!, best.mw) ? { mw: p.forecast!, at: p.startTime } : best,
      null,
    )
  const evaluated = series.points.filter((p) => p.evaluated && p.publishTime !== null)
  const horizons = evaluated.map((p) => p.horizonHours).filter((h): h is number => h !== null)
  return {
    peak: pick((a, b) => a > b),
    trough: pick((a, b) => a < b),
    publishTimes: [...new Set(evaluated.map((p) => p.publishTime!))].sort(),
    horizon: horizons.length ? [Math.min(...horizons), Math.max(...horizons)] : null,
  }
}

/** One-line verdict after "Reveal actual" (FR-3.4, ADR 0009 wording). */
export function verdict(band: BandResponse): string {
  const { biasMw, coverage, coverageReason } = band.summary
  const direction =
    biasMw === null
      ? 'No hour had both a forecast and an actual, so there is no average error'
      : biasMw > 0
        ? `Forecast was ${formatPower(biasMw)} too high on average`
        : biasMw < 0
          ? `Forecast was ${formatPower(-biasMw)} too low on average`
          : 'Forecast matched the actual on average'
  const inside =
    coverage && coverage.valid > 0
      ? `actual stayed inside the ${band.level}% band at ${coverage.inside} of ${coverage.valid} hourly points`
      : `band coverage unavailable${coverageReason ? ` (${coverageReason})` : ''}`
  return `${direction}; ${inside}.`
}

/** Band label: confidence level plus observed coverage from the API, never a guarantee. */
export function bandLabel(band: BandResponse): string {
  const { inSampleCoverage, heldOutCoverage } = band.calibration
  const observed = [
    inSampleCoverage !== null ? `${formatShare(inSampleCoverage)} of hours in-sample` : null,
    heldOutCoverage !== null ? `${formatShare(heldOutCoverage)} on held-out days` : null,
  ].filter(Boolean)
  const record = observed.length
    ? ` In the January 2026 backtest it held ${observed.join(' and ')}.`
    : ''
  return `${band.level}% planning band from January errors at this cutoff.${record} Observed, not a promise for other periods.`
}

/** Bias with sign and unit, e.g. "+1.7 GW". */
export function biasText(band: BandResponse): string {
  return formatSignedPower(band.summary.biasMw)
}
