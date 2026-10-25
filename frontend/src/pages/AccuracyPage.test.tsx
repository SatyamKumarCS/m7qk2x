// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, api } from '../api/client.ts'
import type { BreakdownGroup, MetaResponse } from '../api/types.ts'
import type { AsyncState } from '../hooks/useAsync.ts'
import type { Filters } from '../hooks/useFilters.ts'
import { breakdownFixture, metricsFixture, qualityFixture } from '../test/accuracyFixtures.ts'
import { seriesRange } from '../test/fixtures.ts'
import { AccuracyPage } from './AccuracyPage.tsx'

vi.mock('../api/client.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api/client.ts')>()
  return { ...real, api: { metrics: vi.fn(), breakdown: vi.fn(), timeseries: vi.fn() } }
})
// jsdom cannot lay out SVG; record what each chart receives instead.
vi.mock('../components/AccuracyCharts.tsx', () => ({
  BreakdownChart: (p: { title: string; description: string; groups: BreakdownGroup[] }) => (
    <div data-testid="breakdown" data-title={p.title} data-groups={JSON.stringify(p.groups)}>
      {p.title}: {p.description}
    </div>
  ),
  ErrorHistogram: (p: { bins: { count: number }[]; total: number }) => (
    <div data-testid="histogram" data-total={p.total} data-bins={p.bins.length} />
  ),
  LowSampleKey: () => <p>Grey = low sample</p>,
}))

const metrics = vi.mocked(api.metrics)
const breakdown = vi.mocked(api.breakdown)
const timeseries = vi.mocked(api.timeseries)
const FILTERS: Filters = {
  date: '2026-01-02',
  start: '2026-01-02',
  end: '2026-02-01',
  cutoff: '09:20',
  band: 80,
}
const META = { status: 'success', data: { quality: qualityFixture } } as AsyncState<MetaResponse>

function show(filters: Partial<Filters> = {}, meta = META) {
  const onRetryMeta = vi.fn()
  const utils = render(
    <AccuracyPage filters={{ ...FILTERS, ...filters }} meta={meta} onRetryMeta={onRetryMeta} />,
  )
  return { ...utils, onRetryMeta }
}
const cards = () => within(screen.getByLabelText('Accuracy metrics'))
const chart = (title: string) =>
  screen.getAllByTestId('breakdown').find((c) => c.dataset.title === title)!

beforeEach(() => {
  metrics.mockImplementation(async (q) => metricsFixture(q))
  breakdown.mockImplementation(async (by, q) => breakdownFixture(by, q))
  timeseries.mockImplementation(async (q) => seriesRange(q.start, q.end, { cutoff: q.cutoff }))
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Accuracy report renders live metrics', () => {
  it('shows the six metric cards with units, help text and the bias caveat', async () => {
    show()

    expect(await screen.findByText('2.0 GW')).toBeTruthy() // MAE
    expect(screen.getByText(/09:20 UK time/).parentElement?.textContent).toMatch(/\(31 days\)/)
    for (const [label, value] of [
      ['Mean absolute error (MAE)', '2.0 GW'],
      ['RMSE', '2.5 GW'],
      ['P90 absolute error', '4.2 GW'],
      ['nMAE', '17.9 %'],
      ['Hours compared (n)', '744'],
      ['Bias (forecast − actual)', '+1.7 GW'],
    ]) {
      const term = cards().getByText(label)
      expect(term.parentElement?.textContent).toContain(value)
    }
    expect(cards().getByText(/Typical miss per hour/)).toBeTruthy()
    expect(cards().getByText(/Cause not known\. Operationally metered GB wind only/)).toBeTruthy()
  })

  it('asks for every breakdown with the current filters and passes groups to the charts', async () => {
    show()
    await screen.findAllByTestId('breakdown')

    const q = { start: '2026-01-02', end: '2026-02-01', cutoff: '09:20' }
    for (const by of ['horizon', 'hour', 'level', 'day'])
      expect(breakdown).toHaveBeenCalledWith(by, q, expect.any(AbortSignal))
    expect(chart('Error by forecast horizon').textContent).toMatch(
      /cutoff does not apply.*\[48,72\) h covers only 19 of 24 UK hours/,
    )
    expect(JSON.parse(chart('Error by hour of day').dataset.groups!)).toHaveLength(24)
    expect(chart('Daily MAE').textContent).toContain('31 of 31 days have fewer than 30 hours')
    expect(screen.getByTestId('histogram').dataset.total).toBe('744')
    expect(screen.getByText('Grey = low sample')).toBeTruthy()
  })

  it('writes three key findings from the API numbers', async () => {
    show()
    const findings = within(await screen.findByRole('region', { name: 'Key findings' }))

    const items = findings.getAllByRole('listitem').map((li) => li.textContent)
    expect(items).toHaveLength(3)
    expect(items[0]).toMatch(/too high on average by 1\.7 GW.*744 of 744 hours/)
    expect(items[1]).toMatch(/grows with horizon/)
    expect(items[2]).toMatch(/By wind level/)
  })

  it('shows rows kept and excluded with reasons from the quality report', async () => {
    show()
    const quality = within(await screen.findByRole('region', { name: 'Data quality' }))

    expect(quality.getByText(/1,534 of 1,536 half-hours kept/)).toBeTruthy()
    expect(quality.getByText(/15,775 hourly values from 272 runs kept/)).toBeTruthy()
    const row = quality.getByText('Published after their target time').closest('tr')!
    expect(row.textContent).toContain('4,081')
    expect(await quality.findByText(/This report uses 744 hourly points/)).toBeTruthy()
  })
})

describe('filter changes and boundaries', () => {
  it('refetches when the cutoff changes', async () => {
    const { rerender } = show()
    expect(await screen.findByText('2.0 GW')).toBeTruthy()

    rerender(
      <AccuracyPage filters={{ ...FILTERS, cutoff: '09:50' }} meta={META} onRetryMeta={vi.fn()} />,
    )

    expect(await screen.findByText('1.5 GW')).toBeTruthy()
    expect(metrics).toHaveBeenLastCalledWith(
      { start: '2026-01-02', end: '2026-02-01', cutoff: '09:50' },
      expect.any(AbortSignal),
    )
    expect(screen.getByText(/09:50 UK time/)).toBeTruthy()
  })

  it('handles a single last day and flags the small sample', async () => {
    show({ start: '2026-02-01', end: '2026-02-01' })

    expect(await screen.findByText(/\(1 day\)/)).toBeTruthy()
    expect(await screen.findByRole('note')).toBeTruthy()
    expect(screen.getByRole('note').textContent).toMatch(/Only 24 hourly points .*fewer than 30/)
    expect(JSON.parse(chart('Daily MAE').dataset.groups!)).toHaveLength(1)
    expect(metrics).toHaveBeenCalledWith(
      { start: '2026-02-01', end: '2026-02-01', cutoff: '09:20' },
      expect.any(AbortSignal),
    )
  })

  it('does not warn about sample size for a full week', async () => {
    show({ start: '2026-01-02', end: '2026-01-08' })
    await screen.findAllByTestId('breakdown')

    expect(screen.queryByRole('note')).toBeNull()
  })
})

describe('errors and missing data', () => {
  it('shows the API error and retries', async () => {
    breakdown.mockRejectedValueOnce(new ApiError('Could not reach the server.'))
    show()

    expect(await screen.findByText('Could not reach the server.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('2.0 GW')).toBeTruthy()
  })

  it('shows an empty state when no hour has both a forecast and an actual', async () => {
    metrics.mockImplementation(async (q) => metricsFixture(q, { n: 0 }))
    show({ start: '2026-01-15', end: '2026-01-15' })

    expect(
      await screen.findByText('No hours with both a forecast and an actual in this range.'),
    ).toBeTruthy()
    expect(screen.getByText(/24 hour\(s\) have no forecast at this cutoff/)).toBeTruthy()
    expect(screen.queryByTestId('breakdown')).toBeNull()
  })

  it('keeps the report when the quality report fails, and offers a retry', async () => {
    const meta = { status: 'error', error: 'The server answered 503.' } as AsyncState<MetaResponse>
    const { onRetryMeta } = show({}, meta)

    expect(await screen.findByText('2.0 GW')).toBeTruthy()
    expect(screen.getByText(/Quality report unavailable: The server answered 503\./)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetryMeta).toHaveBeenCalled()
  })
})
