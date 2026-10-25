// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, api } from '../api/client.ts'
import type { Filters } from '../hooks/useFilters.ts'
import { bandFixture, seriesFixture } from '../test/fixtures.ts'
import { DecisionPage } from './DecisionPage.tsx'

vi.mock('../api/client.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api/client.ts')>()
  return { ...real, api: { band: vi.fn(), timeseries: vi.fn() } }
})
// jsdom cannot lay out SVG; record what the chart receives instead.
vi.mock('../components/BandChart.tsx', () => ({
  BandChart: (p: { revealed: boolean; forecast: unknown[] }) => (
    <div
      data-testid="chart"
      data-revealed={String(p.revealed)}
      data-forecast={JSON.stringify(p.forecast)}
    />
  ),
}))

const band = vi.mocked(api.band)
const timeseries = vi.mocked(api.timeseries)
const BOUNDS = { start: '2026-01-02', end: '2026-02-01', defaultCutoff: '09:20' }
const FILTERS: Filters = {
  date: '2026-01-15',
  start: '2026-01-02',
  end: '2026-02-01',
  cutoff: '09:20',
  band: 80,
}

function show(filters: Partial<Filters> = {}, onChange = vi.fn()) {
  const utils = render(
    <DecisionPage filters={{ ...FILTERS, ...filters }} bounds={BOUNDS} onChange={onChange} />,
  )
  return { ...utils, onChange }
}

beforeEach(() => {
  band.mockImplementation(async (date, cutoff, level) =>
    bandFixture({ date, cutoff, level, offset: cutoff === '09:50' ? 500 : 0 }),
  )
  timeseries.mockImplementation(async (q) => seriesFixture({ date: q.start, cutoff: q.cutoff }))
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Decision view renders the decision-time forecast', () => {
  it('shows the cutoff, KPIs and the band label from the API', async () => {
    show()

    expect(await screen.findByText(/278\.6 GWh/)).toBeTruthy()
    expect(screen.getByText(/09:20 UK time/).parentElement?.textContent).toMatch(
      /Wed,? 14 Jan 2026/,
    )
    expect(screen.getByText(/278,630 MWh · over 24 of 24 h/)).toBeTruthy()
    const kpis = within(screen.getByLabelText('Forecast summary'))
    expect(kpis.getByText('12.3 GW')).toBeTruthy() // peak
    expect(kpis.getByText('at 23:00 UK time')).toBeTruthy()
    expect(screen.getByText(/Wed,? 14 Jan,? 07:30/)).toBeTruthy() // run used
    expect(screen.getByText('16.5 h – 39.5 h')).toBeTruthy()
    const label = screen.getByText(/planning band from January errors/)
    expect(label.textContent).toContain('79.8 % of hours in-sample and 78.4 % on held-out days')
    expect(label.textContent).not.toMatch(/guarantee/i)
    expect(band).toHaveBeenCalledWith('2026-01-15', '09:20', 80, expect.any(AbortSignal))
  })

  it('keeps the actual hidden until "Reveal actual" is pressed (FR-3.3, FR-3.4)', async () => {
    show()
    const button = await screen.findByRole('button', { name: 'Reveal actual' })

    expect(button.getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByTestId('chart').dataset.revealed).toBe('false')
    expect(screen.queryByText(/hourly points\./)).toBeNull()

    await userEvent.click(button)

    expect(screen.getByTestId('chart').dataset.revealed).toBe('true')
    expect(
      screen.getByText(
        'Forecast was 1.7 GW too high on average; actual stayed inside the 80% band at 22 of 24 hourly points.',
      ),
    ).toBeTruthy()
    expect(screen.getByText('+1.7 GW')).toBeTruthy()
    const biasNote = screen.getByText(/cause is not known/)
    expect(biasNote.textContent).toContain('operationally metered wind') // beside the bias (ADR 0009)
    expect(screen.getAllByText(/Operationally metered/).length).toBeGreaterThan(0)
    expect(screen.getByText(/over 24 of 24 h \(9\.9 % difference\)/)).toBeTruthy()
  })
})

describe('errors and missing data', () => {
  it('shows the API error and retries on request', async () => {
    band.mockRejectedValueOnce(new ApiError('date 2026-03-01 is outside the data scope.', 422))
    show()

    expect(await screen.findByText('date 2026-03-01 is outside the data scope.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText(/278\.6 GWh/)).toBeTruthy()
    expect(band).toHaveBeenCalledTimes(2)
  })

  it('reports missing hours as gaps, never as zero', async () => {
    const gaps = { missingForecastHours: [0, 1] }
    band.mockResolvedValue(bandFixture(gaps))
    timeseries.mockResolvedValue(seriesFixture(gaps))
    show()

    expect(await screen.findByText(/over 22 of 24 h/)).toBeTruthy()
    expect(screen.getByText(/2 of 24 hours have no forecast at this cutoff/)).toBeTruthy()
    const kpis = within(screen.getByLabelText('Forecast summary'))
    expect(kpis.getByText('10.2 GW')).toBeTruthy() // trough skips the missing hours
    expect(kpis.getByText('at 02:00 UK time')).toBeTruthy()
    const chartRows = JSON.parse(screen.getByTestId('chart').dataset.forecast!)
    expect(chartRows[0]).toMatchObject({ forecast: null, band: null })
    const firstRow = within(screen.getByRole('table')).getAllByRole('row')[1]
    expect(firstRow.textContent).toBe('00:00––')
  })

  it('shows an empty state when no forecast was published before the cutoff', async () => {
    const all = { missingForecastHours: Array.from({ length: 24 }, (_, h) => h) }
    band.mockResolvedValue(bandFixture(all))
    timeseries.mockResolvedValue(seriesFixture(all))
    show()

    expect(
      await screen.findByText('No forecast was published before the cutoff for this day.'),
    ).toBeTruthy()
  })

  it('explains a band that could not be calibrated', async () => {
    band.mockResolvedValue(bandFixture({ noBand: true }))
    show()

    expect(await screen.findByText(/No planning band: only 50 valid/)).toBeTruthy()
  })
})

describe('filter changes', () => {
  it('moves one day at a time and stops at the scope edges (FR-3.1)', async () => {
    const { onChange } = show()
    await userEvent.click(await screen.findByRole('button', { name: 'Next delivery day' }))
    expect(onChange).toHaveBeenCalledWith({ date: '2026-01-16' })
    cleanup()

    show({ date: '2026-02-01' })
    expect(
      (await screen.findByRole('button', { name: 'Next delivery day' })).hasAttribute('disabled'),
    ).toBe(true)
    cleanup()
    show({ date: '2026-01-02' })
    expect(
      (await screen.findByRole('button', { name: 'Previous delivery day' })).hasAttribute(
        'disabled',
      ),
    ).toBe(true)
  })

  it('switches the band level through the URL filters', async () => {
    const { onChange } = show()
    const group = await screen.findByRole('group', { name: 'Planning band level' })

    await userEvent.click(within(group).getByRole('button', { name: '90% band' }))

    expect(onChange).toHaveBeenCalledWith({ band: 90 })
  })

  it('refetches and updates the numbers when the cutoff changes', async () => {
    const { rerender } = show()
    expect(await screen.findByText(/278\.6 GWh/)).toBeTruthy()

    rerender(
      <DecisionPage filters={{ ...FILTERS, cutoff: '09:50' }} bounds={BOUNDS} onChange={vi.fn()} />,
    )

    expect(await screen.findByText(/279\.1 GWh/)).toBeTruthy() // fixture adds 500 MWh at 09:50
    expect(band).toHaveBeenLastCalledWith('2026-01-15', '09:50', 80, expect.any(AbortSignal))
    expect(timeseries).toHaveBeenLastCalledWith(
      { start: '2026-01-15', end: '2026-01-15', cutoff: '09:50' },
      expect.any(AbortSignal),
    )
    expect(screen.getByText(/09:50 UK time/)).toBeTruthy()
  })
})
