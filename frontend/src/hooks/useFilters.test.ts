import { describe, expect, it } from 'vitest'
import { type FilterBounds, parseFilters, serializeFilters } from './useFilters.ts'

const BOUNDS: FilterBounds = { start: '2026-01-02', end: '2026-02-01', defaultCutoff: '09:20' }
const DEFAULTS = {
  date: '2026-01-02',
  start: '2026-01-02',
  end: '2026-02-01',
  cutoff: '09:20',
  band: 80,
}

describe('URL state (FR-3.16)', () => {
  it('uses the defaults when the URL has no parameters', () => {
    expect(parseFilters('', BOUNDS)).toEqual(DEFAULTS)
  })

  it('reproduces the same view from a copied URL', () => {
    const view = {
      date: '2026-01-15',
      start: '2026-01-08',
      end: '2026-01-14',
      cutoff: '09:50',
      band: 90 as const,
    }
    const url = serializeFilters(view)

    expect(url).toBe('?date=2026-01-15&start=2026-01-08&end=2026-01-14&cutoff=09%3A50&band=90')
    expect(parseFilters(url, BOUNDS)).toEqual(view)
  })

  it('accepts a custom cutoff', () => {
    expect(parseFilters('?cutoff=07:45', BOUNDS).cutoff).toBe('07:45')
  })
})

describe('invalid or out-of-scope parameters fall back to defaults', () => {
  it.each([
    ['?date=2026-01-01', 'date', '2026-01-02'], // before scope
    ['?date=2026-02-02', 'date', '2026-01-02'], // after scope
    ['?date=2026-02-30', 'date', '2026-01-02'], // not a date
    ['?cutoff=25:00', 'cutoff', '09:20'],
    ['?cutoff=9:20', 'cutoff', '09:20'],
    ['?band=70', 'band', 80],
  ])('%s → %s = %s', (search, key, expected) => {
    expect(parseFilters(search, BOUNDS)[key as keyof typeof DEFAULTS]).toBe(expected)
  })

  it('resets a reversed or out-of-scope range to the whole scope', () => {
    expect(parseFilters('?start=2026-01-20&end=2026-01-10', BOUNDS)).toMatchObject({
      start: '2026-01-02',
      end: '2026-02-01',
    })
    expect(parseFilters('?start=2025-12-30&end=2026-01-10', BOUNDS)).toMatchObject({
      start: '2026-01-02',
      end: '2026-02-01',
    })
  })
})
