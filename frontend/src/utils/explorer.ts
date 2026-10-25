// Pure logic for the Explorer view (PRD FR-3.5–3.8, E-24). Real values are never changed:
// drawing helpers live in separate fields, and missing data stays null (a break in the line).

import type { TimeseriesPoint } from '../api/types.ts'
import { addDays, daysInclusive } from './time.ts'

export const DOWNSAMPLE_AFTER_DAYS = 7 // E-24: longer ranges are drawn at hourly resolution

export interface RangePreset {
  label: string
  start: string
  end: string
}

export interface ExplorerRow {
  t: number // epoch ms (half-hour start, or hour start when downsampled)
  actual: number | null // half-hourly actual, or hourly mean of both half-hours when downsampled
  forecast: number | null // real hourly decision-time forecast, only on forecast hours
  forecastLine: number | null // forecast for drawing: real values plus :30 midpoints (charting only)
  error: number | null // forecast − actual at the forecast time (ADR 0003), only on forecast hours
  publishTime: string | null
  horizonHours: number | null
  forecastHour: boolean // true on hourly forecast targets; false on :30 rows
}

/** Whole scope plus consecutive 7-day weeks from the first delivery day (weeks 1–4). */
export function rangePresets(scopeStart: string, scopeEnd: string): RangePreset[] {
  const presets: RangePreset[] = [{ label: 'Whole January', start: scopeStart, end: scopeEnd }]
  for (let week = 1; week <= 4; week += 1) {
    const start = addDays(scopeStart, 7 * (week - 1))
    const end = addDays(start, 6)
    if (end <= scopeEnd) presets.push({ label: `Week ${week}`, start, end })
  }
  return presets
}

/**
 * Stormiest week (resolves Q-6): the 7 consecutive delivery days with the highest average metered
 * wind. A day counts only its half-hours that have data; a window needs data on all 7 days.
 * Ties go to the earlier week. Returns null when no complete window exists.
 */
export function stormiestWeek(
  points: Pick<TimeseriesPoint, 'startTime' | 'actual'>[],
  scopeStart: string,
  scopeEnd: string,
  dayOf: (iso: string) => string,
): RangePreset | null {
  const byDay = new Map<string, { sum: number; n: number }>()
  for (const p of points) {
    if (p.actual === null) continue
    const day = dayOf(p.startTime)
    const acc = byDay.get(day) ?? { sum: 0, n: 0 }
    acc.sum += p.actual
    acc.n += 1
    byDay.set(day, acc)
  }
  let best: { start: string; mean: number } | null = null
  for (let start = scopeStart; addDays(start, 6) <= scopeEnd; start = addDays(start, 1)) {
    const days = Array.from({ length: 7 }, (_, i) => byDay.get(addDays(start, i)))
    if (days.some((d) => d === undefined)) continue
    const mean = days.reduce((s, d) => s + d!.sum / d!.n, 0) / 7
    if (best === null || mean > best.mean) best = { start, mean }
  }
  return best && { label: 'Stormiest week', start: best.start, end: addDays(best.start, 6) }
}

export function shouldDownsample(start: string, end: string): boolean {
  return daysInclusive(start, end) > DOWNSAMPLE_AFTER_DAYS
}

/**
 * Chart rows from the half-hourly API points. Up to 7 days: one row per half-hour, with the
 * hourly forecast drawn through :30 only when both neighbouring hours exist (PRD §5.3 allows
 * this for charting only). Longer ranges: one row per hour; the actual is the mean of its two
 * half-hours, or null if either is missing.
 */
export function buildRows(points: TimeseriesPoint[], downsample: boolean): ExplorerRow[] {
  const real: ExplorerRow[] = points.map((p) => ({
    t: Date.parse(p.startTime),
    actual: p.actual,
    forecast: p.evaluated ? p.forecast : null,
    forecastLine: p.evaluated ? p.forecast : null,
    error: p.evaluated ? p.error : null,
    publishTime: p.evaluated ? p.publishTime : null,
    horizonHours: p.evaluated ? p.horizonHours : null,
    forecastHour: p.evaluated,
  }))
  if (downsample) {
    return real.flatMap((row, i) => {
      if (!row.forecastHour) return []
      const next = real[i + 1]
      const pair = next && next.t - row.t === 1_800_000 ? next.actual : null
      return [
        { ...row, actual: row.actual !== null && pair !== null ? (row.actual + pair) / 2 : null },
      ]
    })
  }
  return real.map((row, i) => {
    if (row.forecastHour) return row
    const before = real[i - 1]?.forecast ?? null
    const after = real[i + 1]?.forecast ?? null
    return { ...row, forecastLine: before !== null && after !== null ? (before + after) / 2 : null }
  })
}
