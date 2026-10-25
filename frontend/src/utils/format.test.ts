import { describe, expect, it } from 'vitest'
import {
  MISSING,
  formatCount,
  formatEnergy,
  formatHours,
  formatPercent,
  formatPower,
  formatShare,
  formatSignedPower,
} from './format.ts'

describe('units are always shown; large values as GW to 1 dp (FR-3.15)', () => {
  it('formats power in MW below 1,000 MW and GW from 1,000 MW', () => {
    expect(formatPower(845)).toBe('845 MW')
    expect(formatPower(999.4)).toBe('999 MW')
    expect(formatPower(1000)).toBe('1.0 GW')
    expect(formatPower(12345)).toBe('12.3 GW')
    expect(formatPower(-1500)).toBe('-1.5 GW')
  })

  it('signs bias and errors explicitly', () => {
    expect(formatSignedPower(1745.9)).toBe('+1.7 GW')
    expect(formatSignedPower(-420)).toBe('−420 MW')
    expect(formatSignedPower(0)).toBe('0 MW')
  })

  it('formats energy, hours, shares, percentages and counts with units', () => {
    expect(formatEnergy(278630)).toBe('278.6 GWh')
    expect(formatEnergy(845)).toBe('845 MWh')
    expect(formatHours(16.5)).toBe('16.5 h')
    expect(formatShare(0.784)).toBe('78.4 %')
    expect(formatPercent(17.9)).toBe('17.9 %')
    expect(formatCount(15775)).toBe('15,775')
  })

  it('renders missing or non-finite values as a dash, never as zero', () => {
    for (const f of [formatPower, formatSignedPower, formatEnergy, formatHours, formatShare]) {
      expect(f(null)).toBe(MISSING)
      expect(f(undefined)).toBe(MISSING)
      expect(f(Number.NaN)).toBe(MISSING)
    }
  })
})
