// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, api } from '../api/client.ts'
import type { MetricsResponse } from '../api/types.ts'
import type { Filters } from '../hooks/useFilters.ts'
import { seriesRange } from '../test/fixtures.ts'
import { ExplorerPage } from './ExplorerPage.tsx'

vi.mock('../api/client.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api/client.ts')>()
  return { ...real, api: { timeseries: vi.fn(), metrics: vi.fn() } }
})
// jsdom cannot lay out SVG; record what the charts receive instead.
vi.mock('../components/ExplorerChart.tsx', () => ({
  ExplorerChart: (p: { rows: unknown[]; downsampled: boolean }) => (
    <div
      data-testid="chart"
      data-rows={p.rows.length}
      data-downsampled={String(p.downsampled)}
      data-json={JSON.stringify(p.rows.slice(0, 12))}
    />
  ),
}))

const timeseries = vi.mocked(api.timeseries)
const metrics = vi.mocked(api.metrics)
const BOUNDS = { start: '2026-01-02', end: '2026-02-01', defaultCutoff: '09:20' }
const FILTERS: Filters = {
  date: '2026-01-02',
  start: '2026-01-15',
  end: '2026-01-15',
  cutoff: '09:20',
  band: 80,
}
const STORM = Object.fromEntries(['2026-01-20', '2026-01-21', '2026-01-22'].map((d) => [d, 18_000]))

const metricsFor = (cutoff: string): MetricsResponse => ({
  start: '2026-01-15',
  end: '2026-01-15',
  cutoff,
  timezone: 'Europe/London',
  metrics: {
    mae: cutoff === '09:50' ? 1500 : 2022.5,
    rmse: 2497.4,
    bias: 1745.9,
    medianAbs: 1655,
    p90Abs: 4154.4,
    p95Abs: 5268.4,
    maxAbs: 6894,
    nmae: 17.92,
    wape: 17.92,
    mapeAbove1GW: 21.85,
    r: 0.9316,
  },
  counts: { n: 24, missingForecast: 0, missingActual: 0 },
})

function show(filters: Partial<Filters> = {}, onChange = vi.fn()) {
  const utils = render(
    <ExplorerPage filters={{ ...FILTERS, ...filters }} bounds={BOUNDS} onChange={onChange} />,
  )
  return { ...utils, onChange }
}

beforeEach(() => {
  timeseries.mockImplementation(async (q) =>
    seriesRange(q.start, q.end, { cutoff: q.cutoff, windByDay: STORM }),
  )
  metrics.mockImplementation(async (q) => metricsFor(q.cutoff))
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Explorer renders the selected range', () => {
  it('shows the range, comparison and a half-hourly chart for a short range', async () => {
    show()

    expect(await screen.findByText('2.0 GW')).toBeTruthy() // MAE
    expect(screen.getByText(/09:20 UK time/).parentElement?.textContent).toMatch(
      /Thu,? 15 Jan 2026 – Thu,? 15 Jan 2026 \(1 day\)/,
    )
    expect(screen.getByText('+1.7 GW')).toBeTruthy()
    expect(screen.getByText(/Cause not known; operationally metered wind only/)).toBeTruthy()
    const chart = await screen.findByTestId('chart')
    expect(chart.dataset.rows).toBe('48')
    expect(chart.dataset.downsampled).toBe('false')
    expect(timeseries).toHaveBeenCalledWith(
      { start: '2026-01-15', end: '2026-01-15', cutoff: '09:20' },
      expect.any(AbortSignal),
    )
  })

  it('draws the whole month at hourly resolution and says so (E-24)', async () => {
    show({ start: '2026-01-02', end: '2026-02-01' })

    const chart = await screen.findByTestId('chart')
    expect(chart.dataset.rows).toBe(String(31 * 24))
    expect(chart.dataset.downsampled).toBe('true')
    expect(screen.getByText(/longer than 7 days are drawn at hourly resolution/)).toBeTruthy()
  })

  it('lists hourly values in an accessible table when opened', async () => {
    show()
    await userEvent.click(await screen.findByText(/Hourly values \(table, 24 rows\)/))

    const rows = within(screen.getByRole('table')).getAllByRole('row')
    expect(rows).toHaveLength(25)
    expect(rows[1].textContent).toMatch(/Thu,? 15 Jan,? 00:00/)
  })
})

describe('presets and filter changes (FR-3.5)', () => {
  it('applies week and whole-month presets through the URL filters', async () => {
    const { onChange } = show()
    const group = await screen.findByRole('group', { name: 'Date range presets' })

    await userEvent.click(within(group).getByRole('button', { name: 'Week 2, 9 Jan to 15 Jan' }))
    expect(onChange).toHaveBeenLastCalledWith({ start: '2026-01-09', end: '2026-01-15' })
    await userEvent.click(within(group).getByRole('button', { name: 'Whole January' }))
    expect(onChange).toHaveBeenLastCalledWith({ start: '2026-01-02', end: '2026-02-01' })
  })

  it('finds the stormiest week from the scope actuals and explains the rule', async () => {
    const { onChange } = show()
    // Windy 20–22 Jan: the earliest 7-day window containing all three days.
    const button = await screen.findByRole('button', { name: 'Stormiest week, 16 Jan to 22 Jan' })

    await userEvent.click(button)
    expect(onChange).toHaveBeenLastCalledWith({ start: '2026-01-16', end: '2026-01-22' })
    expect(screen.getByText(/highest average metered wind/)).toBeTruthy()
  })

  it('marks the active preset', async () => {
    show({ start: '2026-01-23', end: '2026-01-29' })
    const group = await screen.findByRole('group', { name: 'Date range presets' })

    expect(
      within(group)
        .getByRole('button', { name: /^Week 4/ })
        .getAttribute('aria-pressed'),
    ).toBe('true')
    expect(
      within(group).getByRole('button', { name: 'Whole January' }).getAttribute('aria-pressed'),
    ).toBe('false')
  })

  it('refetches and updates the numbers when the cutoff changes', async () => {
    const { rerender } = show()
    expect(await screen.findByText('2.0 GW')).toBeTruthy()

    rerender(
      <ExplorerPage filters={{ ...FILTERS, cutoff: '09:50' }} bounds={BOUNDS} onChange={vi.fn()} />,
    )

    expect(await screen.findByText('1.5 GW')).toBeTruthy()
    expect(timeseries).toHaveBeenLastCalledWith(
      { start: '2026-01-15', end: '2026-01-15', cutoff: '09:50' },
      expect.any(AbortSignal),
    )
    expect(screen.getByText(/09:50 UK time/)).toBeTruthy()
  })
})

describe('date boundaries', () => {
  it('handles a range ending on the last delivery day', async () => {
    show({ start: '2026-01-26', end: '2026-02-01' })

    const chart = await screen.findByTestId('chart')
    expect(chart.dataset.rows).toBe(String(7 * 48)) // exactly 7 days: not downsampled
    expect(screen.getByText(/\(7 days\)/)).toBeTruthy()
  })

  it('downsamples from 8 days', async () => {
    show({ start: '2026-01-02', end: '2026-01-09' })

    expect((await screen.findByTestId('chart')).dataset.downsampled).toBe('true')
  })
})

describe('errors and missing data', () => {
  it('shows the API error and retries', async () => {
    timeseries.mockRejectedValueOnce(new ApiError('Could not reach the server.'))
    show()

    expect(await screen.findByText('Could not reach the server.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByTestId('chart')).toBeTruthy()
  })

  it('counts gaps and keeps them null in the chart rows', async () => {
    timeseries.mockResolvedValue(
      seriesRange('2026-01-15', '2026-01-15', {
        missingActual: ['2026-01-15T02:00:00Z', '2026-01-15T02:30:00Z'],
        missingForecast: ['2026-01-15T04:00:00Z'],
      }),
    )
    show()

    expect(
      await screen.findByText(
        /1 hour\(s\) have no forecast at this cutoff\. 2 half-hour\(s\) have no actual\./,
      ),
    ).toBeTruthy()
    const rows = JSON.parse((await screen.findByTestId('chart')).dataset.json!)
    expect(rows[4]).toMatchObject({ actual: null }) // 02:00
    expect(rows[8]).toMatchObject({ forecast: null, forecastLine: null }) // 04:00
  })

  it('shows an empty state when the range has no data at all', async () => {
    const empty = seriesRange('2026-01-15', '2026-01-15')
    empty.points = empty.points.map((p) => ({ ...p, actual: null, forecast: null, error: null }))
    timeseries.mockResolvedValue(empty)
    show()

    expect(await screen.findByText('No data for this range.')).toBeTruthy()
  })
})
