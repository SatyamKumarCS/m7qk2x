import { describe, expect, it } from 'vitest'
import type { BreakdownGroup } from '../api/types.ts'
import { breakdownFixture, metricsFixture, qualityFixture } from '../test/accuracyFixtures.ts'
import { binLabel, histogram, keyFindings, lowSampleCount, qualityRows } from './accuracy.ts'

const Q = { start: '2026-01-02', end: '2026-02-01', cutoff: '09:20' }
const g = (group: string, n: number, mae: number | null): BreakdownGroup => ({
  group,
  n,
  mae,
  rmse: mae,
  bias: mae,
  p90: mae,
  lowSample: n < 30,
})

describe('signed-error histogram', () => {
  it('bins at multiples of 500 MW, lower edge inclusive, with no empty edges', () => {
    const bins = histogram([-501, -500, -1, 0, 499, 500, 1250])

    expect(bins.map((b) => [b.lo, b.count])).toEqual([
      [-1000, 1],
      [-500, 2],
      [0, 2],
      [500, 1],
      [1000, 1],
    ])
    expect(bins.reduce((s, b) => s + b.count, 0)).toBe(7)
    expect(binLabel(bins[1])).toBe('−500 MW to 0 MW')
  })

  it('returns no bins for no errors', () => {
    expect(histogram([])).toEqual([])
  })
})

describe('key findings (FR-3.11)', () => {
  const base = {
    metrics: metricsFixture(Q),
    horizon: breakdownFixture('horizon', Q).groups,
    level: breakdownFixture('level', Q).groups,
    hour: breakdownFixture('hour', Q).groups,
    errors: [1000, 2000, -500, 3000],
  }

  it('builds three sentences from the data passed in', () => {
    expect(keyFindings(base)).toEqual([
      'The forecast ran too high on average by 1.7 GW, and was above the actual in 3 of 4 hours; the cause is not known.',
      'Error grows with horizon: MAE is 1.7 GW at [0,6) h ahead and 2.3 GW at [48,72) h (all forecast runs).',
      'By wind level, error is largest at <5 GW (MAE 2.3 GW, 62 hours) and smallest at 5–10 GW (1.7 GW, 248 hours).',
    ])
  })

  it('changes with the numbers: negative bias and a flat horizon profile', () => {
    const metrics = metricsFixture(Q)
    metrics.metrics.bias = -420
    const flat = [g('[0,6)', 100, 2500), g('[6,12)', 100, 2000)]

    const [bias, horizon] = keyFindings({ ...base, metrics, horizon: flat, errors: [-1, -2, 3] })
    expect(bias).toMatch(
      /^The forecast ran too low on average by 420 MW, and was above the actual in 1 of 3 hours/,
    )
    expect(horizon).toMatch(/does not grow with horizon.*\[0,6\) h.*2\.5 GW/)
  })

  it('skips low-sample groups and falls back to hour of day when levels are too thin', () => {
    const level = [g('<5 GW', 5, 9000), g('5–10 GW', 12, 100)]
    const hour = [g('00', 31, 1500), g('01', 31, 2500), g('02', 3, 9999)]

    const third = keyFindings({ ...base, level, hour })[2]
    expect(third).toBe(
      'By UK hour, error is largest at 01:00 (MAE 2.5 GW, 31 hours) and smallest at 00:00 (1.5 GW, 31 hours).',
    )
  })

  it('returns no sentences when there is nothing reliable to say', () => {
    const metrics = metricsFixture(Q, { n: 0 })
    const thin = [g('a', 3, 100), g('b', 2, 200)]

    expect(keyFindings({ metrics, horizon: thin, level: thin, hour: thin, errors: [] })).toEqual([])
  })
})

describe('low-sample groups and the quality report', () => {
  it('counts flagged groups (every single day is below 30 hours)', () => {
    expect(lowSampleCount(breakdownFixture('day', Q).groups)).toBe(31)
    expect(lowSampleCount(breakdownFixture('horizon', Q).groups)).toBe(0)
  })

  it('lists rows kept and excluded with reasons', () => {
    const { actuals, forecasts } = qualityRows(qualityFixture)

    expect(actuals).toMatchObject({ kept: 1534, expected: 1536 })
    expect(actuals.excluded[0]).toEqual({ label: 'Missing half-hours', count: 2 })
    expect(forecasts).toMatchObject({ kept: 15775, runs: 272 })
    expect(forecasts.excluded[0]).toEqual({
      label: 'Published after their target time',
      count: 4081,
    })
  })
})
