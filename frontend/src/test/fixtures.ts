// Spec-shaped API responses for one delivery day (docs/spec.md §5), with optional gaps.

import type { BandResponse, TimeseriesResponse } from '../api/types.ts'

const HOURS = Array.from({ length: 24 }, (_, h) => h)
const at = (date: string, h: number, m = 0) =>
  `${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`

export interface DayOptions {
  date?: string
  cutoff?: string
  level?: 80 | 90
  missingForecastHours?: number[] // hours with no decision-time forecast
  offset?: number // added to every forecast (to tell cutoffs apart)
  noBand?: boolean // calibration failed
}

export function bandFixture(o: DayOptions = {}): BandResponse {
  const {
    date = '2026-01-15',
    cutoff = '09:20',
    level = 80,
    missingForecastHours = [],
    offset = 0,
  } = o
  const points = HOURS.map((h) => {
    const missing = missingForecastHours.includes(h)
    const forecast = missing ? null : 10_000 + h * 100 + offset
    return {
      startTime: at(date, h),
      forecast,
      lower: forecast === null || o.noBand ? null : forecast - 4154.4,
      upper: forecast === null || o.noBand ? null : forecast + 426.4,
      actual: 9_000 + h * 100,
      inside: forecast === null || o.noBand ? null : h !== 3 && h !== 4,
    }
  })
  const forecastHours = 24 - missingForecastHours.length
  return {
    date,
    cutoff,
    level,
    timezone: 'Europe/London',
    qLo: o.noBand ? null : -426.4,
    qHi: o.noBand ? null : 4154.4,
    calibration: {
      start: '2026-01-02',
      end: '2026-02-01',
      n: o.noBand ? 50 : 744,
      method: 'empirical-type7-global',
      inSampleCoverage: o.noBand ? null : 0.7984,
      heldOutCoverage: o.noBand ? null : 0.7844,
    },
    points,
    summary: {
      date,
      points: 24,
      validPairs: forecastHours,
      maeMw: 1000 + offset,
      biasMw: 1745.9 + offset,
      forecastMwh: forecastHours ? 278_630 + offset : null,
      forecastHours,
      actualMwh: 253_626,
      actualHours: 24,
      energyComparison: forecastHours
        ? { hours: forecastHours, forecastMwh: 278_630, actualMwh: 253_626, errorPct: 9.86 }
        : null,
      coverage: o.noBand
        ? null
        : { inside: forecastHours - 2, below: 2, above: 0, valid: forecastHours, coverage: 0.9167 },
      coverageReason: o.noBand
        ? 'only 50 valid forecast/actual hours in the calibration window; at least 100 are needed'
        : null,
      notes: {
        scope: 'Operationally metered GB wind only (Elexon FUELHH WIND vs WINDFOR).',
        bias: 'Average forecast − actual. Its cause is not known; it is reported, not explained.',
      },
      containsForecast: o.noBand
        ? null
        : { points: forecastHours, contained: forecastHours, all: true },
    },
    reason: o.noBand
      ? 'only 50 valid forecast/actual hours in the calibration window; at least 100 are needed'
      : null,
  }
}

export function seriesFixture(o: DayOptions = {}): TimeseriesResponse {
  const { date = '2026-01-15', cutoff = '09:20', missingForecastHours = [] } = o
  const points = HOURS.flatMap((h) =>
    [0, 30].map((m) => {
      const evaluated = m === 0
      const hasForecast = evaluated && !missingForecastHours.includes(h)
      return {
        startTime: at(date, h, m),
        actual: 9_000 + h * 100,
        forecast: hasForecast ? 10_000 + h * 100 : null,
        publishTime: hasForecast ? '2026-01-14T07:30:00Z' : null,
        horizonHours: hasForecast ? 16.5 + h : null,
        error: hasForecast ? 1000 : null,
        evaluated,
      }
    }),
  )
  return {
    start: date,
    end: date,
    cutoff,
    timezone: 'Europe/London',
    points,
    counts: {
      n: 24 - missingForecastHours.length,
      missingForecast: missingForecastHours.length,
      missingActual: 0,
    },
  }
}

export interface RangeOptions {
  cutoff?: string
  windByDay?: Record<string, number> // base actual MW per day (default 9,000)
  missingActual?: string[] // ISO half-hour start times with no actual
  missingForecast?: string[] // ISO hour start times with no forecast
}

/** Half-hourly timeseries over [start, end] (UK = UTC in January), spec §5 shape. */
export function seriesRange(start: string, end: string, o: RangeOptions = {}): TimeseriesResponse {
  const points: TimeseriesResponse['points'] = []
  for (
    let t = Date.parse(`${start}T00:00:00Z`);
    t < Date.parse(`${end}T00:00:00Z`) + 86_400_000;
    t += 1_800_000
  ) {
    const iso = new Date(t).toISOString().replace('.000Z', 'Z')
    const day = iso.slice(0, 10)
    const evaluated = iso.slice(14, 16) === '00'
    const actual = o.missingActual?.includes(iso)
      ? null
      : (o.windByDay?.[day] ?? 9_000) + ((t / 1_800_000) % 7)
    const forecast = evaluated && !o.missingForecast?.includes(iso) ? 10_000 : null
    points.push({
      startTime: iso,
      actual,
      forecast,
      publishTime: forecast === null ? null : `${day}T07:30:00Z`,
      horizonHours: forecast === null ? null : 16.5,
      error:
        forecast === null || actual === null ? null : Math.round((forecast - actual) * 10) / 10,
      evaluated,
    })
  }
  const hours = points.filter((p) => p.evaluated)
  return {
    start,
    end,
    cutoff: o.cutoff ?? '09:20',
    timezone: 'Europe/London',
    points,
    counts: {
      n: hours.filter((p) => p.forecast !== null && p.actual !== null).length,
      missingForecast: hours.filter((p) => p.forecast === null).length,
      missingActual: hours.filter((p) => p.actual === null).length,
    },
  }
}
