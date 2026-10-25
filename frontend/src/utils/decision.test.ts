import { describe, expect, it } from 'vitest'
import { bandFixture, seriesFixture } from '../test/fixtures.ts'
import { bandLabel, biasText, buildSeries, dayKpis, verdict } from './decision.ts'

describe('chart series keep gaps as gaps', () => {
  it('leaves missing forecast hours null (never zero) and has no band there', () => {
    const { forecast, actual } = buildSeries(
      bandFixture({ missingForecastHours: [5] }),
      seriesFixture({ missingForecastHours: [5] }),
    )

    expect(forecast).toHaveLength(24)
    expect(forecast[5]).toEqual({
      t: Date.parse('2026-01-15T05:00:00Z'),
      forecast: null,
      band: null,
    })
    expect(forecast[6].band).toEqual([10_600 - 4154.4, 10_600 + 426.4])
    expect(actual).toHaveLength(48) // half-hourly actuals
  })
})

describe('KPIs (FR-3.2)', () => {
  it('finds peak and trough among real values only, plus run and horizon range', () => {
    const k = dayKpis(
      bandFixture({ missingForecastHours: [0, 23] }),
      seriesFixture({ missingForecastHours: [0, 23] }),
    )

    expect(k.trough).toEqual({ mw: 10_100, at: '2026-01-15T01:00:00Z' }) // hour 0 is missing, not 0 MW
    expect(k.peak).toEqual({ mw: 12_200, at: '2026-01-15T22:00:00Z' })
    expect(k.publishTimes).toEqual(['2026-01-14T07:30:00Z'])
    expect(k.horizon).toEqual([17.5, 38.5])
  })

  it('returns nulls when no hour has a forecast', () => {
    const all = Array.from({ length: 24 }, (_, h) => h)
    const k = dayKpis(
      bandFixture({ missingForecastHours: all }),
      seriesFixture({ missingForecastHours: all }),
    )

    expect(k).toEqual({ peak: null, trough: null, publishTimes: [], horizon: null })
  })
})

describe('verdict and labels (ADR 0009)', () => {
  it('words the verdict as "inside the band at X of Y hourly points"', () => {
    expect(verdict(bandFixture())).toBe(
      'Forecast was 1.7 GW too high on average; actual stayed inside the 80% band at 22 of 24 hourly points.',
    )
  })

  it('counts only valid points when hours are missing', () => {
    expect(verdict(bandFixture({ missingForecastHours: [1, 2] }))).toContain(
      'at 20 of 22 hourly points',
    )
  })

  it('says why coverage is unavailable instead of inventing it', () => {
    expect(verdict(bandFixture({ noBand: true }))).toContain(
      'band coverage unavailable (only 50 valid',
    )
  })

  it('reports observed coverage from the API and never promises it', () => {
    const label = bandLabel(bandFixture())

    expect(label).toContain('80% planning band')
    expect(label).toContain('79.8 % of hours in-sample')
    expect(label).toContain('78.4 % on held-out days')
    expect(label).not.toMatch(/guarantee/i)
  })

  it('signs the bias with units', () => {
    expect(biasText(bandFixture())).toBe('+1.7 GW')
  })
})
