// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { breakdownFixture } from '../test/accuracyFixtures.ts'
import { BreakdownChart, LowSampleKey } from './AccuracyCharts.tsx'

afterEach(cleanup)

describe('breakdown chart table (E-16)', () => {
  it('lists every group with its n and labels low-sample groups', async () => {
    const q = { start: '2026-02-01', end: '2026-02-01', cutoff: '09:20' }
    render(
      <BreakdownChart
        title="Error by wind level"
        description="Grouped by metered wind."
        groups={breakdownFixture('level', q).groups}
        groupHeader="Metered wind level"
        showN
      />,
    )
    await userEvent.click(screen.getByText(/Error by wind level \(table, 4 rows\)/))

    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1)
    expect(rows.map((r) => r.textContent)).toEqual([
      '<5 GW (low sample)22.3 GW2.7 GW+2.3 GW4.5 GW',
      '5–10 GW (low sample)81.7 GW2.0 GW+1.7 GW3.3 GW',
      '10–15 GW (low sample)82.2 GW2.6 GW+2.2 GW4.3 GW',
      '≥15 GW (low sample)62.2 GW2.7 GW+2.2 GW4.5 GW',
    ])
    expect(screen.getByRole('img', { name: /Error by wind level/ })).toBeTruthy()
  })

  it('explains grey bars in the key', () => {
    render(<LowSampleKey />)
    expect(screen.getByText(/Grey = low sample: fewer than 30 hours/)).toBeTruthy()
  })
})
