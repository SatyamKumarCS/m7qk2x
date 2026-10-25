// Spec-shaped responses for the Accuracy report (docs/spec.md §5). Numbers echo the real
// 09:20 January run so the page reads realistically; options vary what the tests need.

import type {
  BreakdownBy,
  BreakdownGroup,
  BreakdownResponse,
  MetricsResponse,
  QualityReport,
  RangeQuery,
} from '../api/types.ts'
import { addDays, daysInclusive } from '../utils/time.ts'

const group = (name: string, n: number, mae: number | null, bias: number | null = mae) =>
  ({
    group: name,
    n,
    mae,
    rmse: mae === null ? null : mae * 1.2,
    bias,
    p90: mae === null ? null : mae * 2,
    lowSample: n < 30,
  }) satisfies BreakdownGroup

export function metricsFixture(
  q: RangeQuery,
  o: { n?: number; mae?: number } = {},
): MetricsResponse {
  const n = o.n ?? daysInclusive(q.start, q.end) * 24
  const mae = n === 0 ? null : (o.mae ?? (q.cutoff === '09:50' ? 1500 : 2022.5))
  return {
    ...q,
    timezone: 'Europe/London',
    metrics: {
      mae,
      rmse: mae && 2497.4,
      bias: mae && 1745.9,
      medianAbs: mae && 1655,
      p90Abs: mae && 4154.4,
      p95Abs: mae && 5268.4,
      maxAbs: mae && 6894,
      nmae: mae && 17.92,
      wape: mae && 17.92,
      mapeAbove1GW: mae && 21.85,
      r: mae && 0.9316,
    },
    counts: { n, missingForecast: o.n === 0 ? 24 : 0, missingActual: 0 },
  }
}

export function breakdownFixture(by: BreakdownBy, q: RangeQuery): BreakdownResponse {
  const days = daysInclusive(q.start, q.end)
  const groups: Record<BreakdownBy, BreakdownGroup[]> = {
    horizon: [
      group('[0,6)', 1446, 1681.3),
      group('[6,12)', 1456, 1752.4),
      group('[12,24)', 2954, 1891.8),
      group('[24,36)', 2976, 2004.2),
      group('[36,48)', 2945, 2233.8),
      group('[48,72)', 2510, 2307.4, 1415),
    ],
    hour: Array.from({ length: 24 }, (_, h) =>
      group(String(h).padStart(2, '0'), days, 1800 + h * 20),
    ),
    level: [
      group('<5 GW', days * 2, 2263.9),
      group('5–10 GW', days * 8, 1658.7),
      group('10–15 GW', days * 8, 2161.7),
      group('≥15 GW', days * 6, 2236),
    ],
    day: Array.from({ length: days }, (_, i) => group(addDays(q.start, i), 24, 1000 + i * 50)),
  }
  return {
    start: q.start,
    end: q.end,
    cutoff: by === 'horizon' ? null : q.cutoff,
    timezone: 'Europe/London',
    by,
    groups: groups[by],
    note:
      by === 'horizon'
        ? '[48,72) h covers only 19 of 24 UK hours (forecast runs end at 21:00 UTC two days after publication), so compare it with care.'
        : null,
  }
}

export const qualityFixture: QualityReport = {
  inputs: [],
  actuals: {
    rows: 1534,
    expected: 1536,
    missingSlots: ['2026-01-10T03:00:00Z', '2026-01-10T03:30:00Z'],
    duplicates: 0,
    revisionsCollapsed: 0,
    nonWindDropped: 0,
    nulls: 0,
    negatives: 0,
    spikes: 0,
    spikeTimes: [],
    startTimeRange: ['2026-01-01T00:00:00Z', '2026-02-01T23:30:00Z'],
    generationRangeMw: [1695, 17805],
    resolutionMinutes: 30,
  },
  forecasts: {
    rows: 15775,
    runs: 272,
    runsPerPublishDay: { '8': 34 },
    publishClockTimes: {},
    duplicates: 0,
    conflictingDuplicates: 0,
    droppedPublishedAfterTarget: 4081,
    nulls: 0,
    negatives: 0,
    spikes: 0,
    spikeTimes: [],
    publishTimeRange: ['2025-12-29T02:30:00Z', '2026-01-31T22:30:00Z'],
    startTimeRange: ['2025-12-29T03:00:00Z', '2026-02-02T21:00:00Z'],
    horizonRangeH: [0.5, 66.5],
    generationRangeMw: [2292, 21353],
    resolutionMinutes: 60,
  },
}
