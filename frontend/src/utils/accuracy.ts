// Pure logic for the Accuracy report (PRD FR-3.9–3.12, E-15, E-16): plain-English metric help,
// the signed-error histogram, key findings built from live API numbers, and quality-report rows.

import type { BreakdownGroup, MetricsResponse, QualityReport } from '../api/types.ts'
import { formatCount, formatPower, formatSignedPower } from './format.ts'

export const LOW_SAMPLE_N = 30 // mirrors backend config.LOW_SAMPLE_N (the API sets lowSample)
export const HISTOGRAM_BIN_MW = 500

/** One-line explanations shown with each metric card (FR-3.9). */
export const METRIC_HELP = {
  mae: 'Typical miss per hour, ignoring direction.',
  rmse: 'Like MAE, but big misses count extra.',
  bias: 'Average forecast − actual: above zero means the forecast ran high.',
  p90Abs: '9 hours in 10 missed by less than this.',
  nmae: 'MAE as a share of the average metered wind.',
  n: 'Hourly points with both a forecast and an actual.',
} as const

export interface HistogramBin {
  lo: number // MW, inclusive
  hi: number // MW, exclusive
  count: number
}

/** Signed errors in fixed-width bins aligned to multiples of `binMw`, with no empty edges. */
export function histogram(errors: number[], binMw = HISTOGRAM_BIN_MW): HistogramBin[] {
  if (errors.length === 0) return []
  const index = (e: number) => Math.floor(e / binMw)
  const first = Math.min(...errors.map(index))
  const last = Math.max(...errors.map(index))
  const bins = Array.from({ length: last - first + 1 }, (_, i) => ({
    lo: (first + i) * binMw,
    hi: (first + i + 1) * binMw,
    count: 0,
  }))
  for (const e of errors) bins[index(e) - first].count += 1
  return bins
}

const usable = (groups: BreakdownGroup[]) =>
  groups.filter((g) => !g.lowSample && g.n > 0 && g.mae !== null)

export interface FindingsInput {
  metrics: MetricsResponse
  horizon: BreakdownGroup[]
  level: BreakdownGroup[]
  hour: BreakdownGroup[]
  errors: number[] // signed errors at the valid hourly points of the selected range
}

/** Up to three sentences, each computed from the API data for the current filters (FR-3.11). */
export function keyFindings({ metrics, horizon, level, hour, errors }: FindingsInput): string[] {
  const findings: string[] = []
  const { bias } = metrics.metrics
  if (bias !== null && errors.length > 0) {
    const over = errors.filter((e) => e > 0).length
    const direction = bias >= 0 ? 'too high' : 'too low'
    findings.push(
      `The forecast ran ${direction} on average by ${formatPower(Math.abs(bias))}, and was above ` +
        `the actual in ${formatCount(over)} of ${formatCount(errors.length)} hours; the cause is not known.`,
    )
  }

  const buckets = usable(horizon)
  if (buckets.length >= 2) {
    const nearest = buckets[0]
    const worst = buckets.reduce((a, b) => (b.mae! > a.mae! ? b : a))
    findings.push(
      worst === nearest
        ? `Error does not grow with horizon here: the shortest-horizon bucket (${nearest.group} h) has the highest MAE, ${formatPower(nearest.mae)}.`
        : `Error grows with horizon: MAE is ${formatPower(nearest.mae)} at ${nearest.group} h ahead and ${formatPower(worst.mae)} at ${worst.group} h (all forecast runs).`,
    )
  }

  const [groups, noun] =
    usable(level).length >= 2 ? [usable(level), 'wind level'] : [usable(hour), 'UK hour']
  if (groups.length >= 2) {
    const worst = groups.reduce((a, b) => (b.mae! > a.mae! ? b : a))
    const best = groups.reduce((a, b) => (b.mae! < a.mae! ? b : a))
    const label = (g: BreakdownGroup) => (noun === 'UK hour' ? `${g.group}:00` : g.group)
    findings.push(
      `By ${noun}, error is largest at ${label(worst)} (MAE ${formatPower(worst.mae)}, ${formatCount(worst.n)} hours) ` +
        `and smallest at ${label(best)} (${formatPower(best.mae)}, ${formatCount(best.n)} hours).`,
    )
  }
  return findings
}

/** "3 of 31 groups" style count of groups the API flags as low sample (E-16). */
export function lowSampleCount(groups: BreakdownGroup[]): number {
  return groups.filter((g) => g.lowSample).length
}

export interface QualityRow {
  label: string
  count: number
}

/** Rows kept and excluded, with reasons, from the offline quality report (FR-3.12, UC-7). */
export function qualityRows(q: QualityReport): {
  actuals: { kept: number; expected: number; excluded: QualityRow[] }
  forecasts: { kept: number; runs: number; excluded: QualityRow[] }
} {
  return {
    actuals: {
      kept: q.actuals.rows,
      expected: q.actuals.expected,
      excluded: [
        { label: 'Missing half-hours', count: q.actuals.missingSlots.length },
        { label: 'Duplicates removed', count: q.actuals.duplicates },
        { label: 'Revisions collapsed to the latest', count: q.actuals.revisionsCollapsed },
        { label: 'Non-wind rows dropped', count: q.actuals.nonWindDropped },
        { label: 'Empty values', count: q.actuals.nulls },
        { label: 'Negative values', count: q.actuals.negatives },
        { label: 'Spikes flagged', count: q.actuals.spikes },
      ],
    },
    forecasts: {
      kept: q.forecasts.rows,
      runs: q.forecasts.runs,
      excluded: [
        {
          label: 'Published after their target time',
          count: q.forecasts.droppedPublishedAfterTarget,
        },
        { label: 'Duplicates removed', count: q.forecasts.duplicates },
        { label: 'Conflicting duplicates', count: q.forecasts.conflictingDuplicates },
        { label: 'Empty values', count: q.forecasts.nulls },
        { label: 'Negative values', count: q.forecasts.negatives },
        { label: 'Spikes flagged', count: q.forecasts.spikes },
      ],
    },
  }
}

/** Histogram bin label: "+0.5 to +1.0 GW". */
export function binLabel(bin: HistogramBin): string {
  return `${formatSignedPower(bin.lo)} to ${formatSignedPower(bin.hi)}`
}
