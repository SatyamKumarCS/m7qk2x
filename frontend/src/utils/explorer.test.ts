import { describe, expect, it } from 'vitest'
import { seriesRange } from '../test/fixtures.ts'
import { buildRows, rangePresets, shouldDownsample, stormiestWeek } from './explorer.ts'

const SCOPE = ['2026-01-02', '2026-02-01'] as const
const dayOf = (iso: string) => iso.slice(0, 10) // UK = UTC in January

describe('range presets (FR-3.5)', () => {
  it('offers the whole scope and four 7-day weeks, all inside the scope', () => {
    const presets = rangePresets(...SCOPE)

    expect(presets.map((p) => `${p.label} ${p.start}..${p.end}`)).toEqual([
      'Whole January 2026-01-02..2026-02-01',
      'Week 1 2026-01-02..2026-01-08',
      'Week 2 2026-01-09..2026-01-15',
      'Week 3 2026-01-16..2026-01-22',
      'Week 4 2026-01-23..2026-01-29',
    ])
  })
})

describe('stormiest week (Q-6: highest average metered wind over 7 consecutive days)', () => {
  it('picks the windiest 7-day window', () => {
    const wind = Object.fromEntries(
      ['2026-01-20', '2026-01-21', '2026-01-22'].map((d) => [d, 18_000]),
    )
    const points = seriesRange(...SCOPE, { windByDay: wind }).points

    expect(stormiestWeek(points, ...SCOPE, dayOf)).toEqual({
      label: 'Stormiest week',
      start: '2026-01-16',
      end: '2026-01-22',
    })
  })

  it('breaks ties towards the earlier week and can end on the last day of scope', () => {
    const flat = seriesRange(...SCOPE).points
    expect(stormiestWeek(flat, ...SCOPE, dayOf)?.start).toBe('2026-01-02')

    const lastWeek = Object.fromEntries(
      [
        '2026-01-26',
        '2026-01-27',
        '2026-01-28',
        '2026-01-29',
        '2026-01-30',
        '2026-01-31',
        '2026-02-01',
      ].map((d) => [d, 20_000]),
    )
    expect(
      stormiestWeek(seriesRange(...SCOPE, { windByDay: lastWeek }).points, ...SCOPE, dayOf)?.end,
    ).toBe('2026-02-01')
  })

  it('skips windows that include a day without any actual data', () => {
    const missing = seriesRange('2026-01-02', '2026-01-02').points.map((p) => p.startTime)
    const points = seriesRange('2026-01-02', '2026-01-09', { missingActual: missing }).points

    expect(stormiestWeek(points, '2026-01-02', '2026-01-09', dayOf)?.start).toBe('2026-01-03')
    expect(stormiestWeek(points, '2026-01-02', '2026-01-08', dayOf)).toBeNull()
  })
})

describe('chart rows (FR-3.8, E-24)', () => {
  it('downsamples only ranges longer than 7 days', () => {
    expect(shouldDownsample('2026-01-02', '2026-01-08')).toBe(false) // exactly 7 days
    expect(shouldDownsample('2026-01-02', '2026-01-09')).toBe(true) // 8 days
    expect(shouldDownsample('2026-01-15', '2026-01-15')).toBe(false)
  })

  it('keeps half-hours for short ranges and draws :30 forecast only between two real hours', () => {
    const data = seriesRange('2026-01-15', '2026-01-15', {
      missingForecast: ['2026-01-15T05:00:00Z'],
    })
    const rows = buildRows(data.points, false)

    expect(rows).toHaveLength(48)
    expect(rows[1]).toMatchObject({ forecast: null, forecastLine: 10_000, forecastHour: false }) // 00:30
    expect(rows[10]).toMatchObject({ forecast: null, forecastLine: null, forecastHour: true }) // 05:00 gap
    expect(rows[9].forecastLine).toBeNull() // 04:30: next hour is missing, so no line through it
    expect(rows[11].forecastLine).toBeNull() // 05:30
  })

  it('downsamples to hourly means and leaves an hour empty if a half-hour is missing', () => {
    const data = seriesRange('2026-01-02', '2026-01-09', {
      missingActual: ['2026-01-02T03:30:00Z'],
    })
    const rows = buildRows(data.points, true)
    const first = data.points[0].actual!
    const second = data.points[1].actual!

    expect(rows).toHaveLength(8 * 24)
    expect(rows[0].actual).toBeCloseTo((first + second) / 2)
    expect(rows[3].actual).toBeNull() // 03:00 hour is missing its 03:30 half-hour: a gap, not a guess
    expect(rows.every((r) => r.forecastHour)).toBe(true)
  })
})
