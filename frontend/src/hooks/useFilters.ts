// URL query parameters are the single source of view state (spec §6, FR-3.16):
// date, start, end, cutoff, band. Anything invalid or out of scope falls back to a default,
// and the URL is rewritten to the canonical form, so a copied link always reproduces the view.

import { useCallback, useMemo } from 'react'
import { BAND_LEVELS, type BandLevel, DEFAULT_BAND } from '../constants.ts'
import { isValidCutoff, isWithin } from '../utils/time.ts'
import { navigate, useLocation } from './useLocation.ts'

export interface Filters {
  date: string // Decision view delivery day
  start: string // range start (inclusive)
  end: string // range end (inclusive)
  cutoff: string // HH:MM, UK time
  band: BandLevel
}

export interface FilterBounds {
  start: string // first in-scope delivery day
  end: string // last in-scope delivery day
  defaultCutoff: string
}

export function parseFilters(search: string, bounds: FilterBounds): Filters {
  const q = new URLSearchParams(search)
  const inScope = (v: string | null): v is string =>
    v !== null && isWithin(v, bounds.start, bounds.end)
  const date = q.get('date')
  let start = q.get('start')
  let end = q.get('end')
  if (!inScope(start) || !inScope(end) || start > end) {
    start = bounds.start
    end = bounds.end
  }
  const cutoff = q.get('cutoff')
  const band = Number(q.get('band'))
  return {
    date: inScope(date) ? date : bounds.start,
    start,
    end,
    cutoff: cutoff !== null && isValidCutoff(cutoff) ? cutoff : bounds.defaultCutoff,
    band: (BAND_LEVELS as readonly number[]).includes(band) ? (band as BandLevel) : DEFAULT_BAND,
  }
}

/** Canonical query string: every parameter, in a fixed order. */
export function serializeFilters(f: Filters): string {
  const q = new URLSearchParams({
    date: f.date,
    start: f.start,
    end: f.end,
    cutoff: f.cutoff,
    band: String(f.band),
  })
  return `?${q}`
}

/** `bounds` should be memoised by the caller; it changes only when /api/meta loads. */
export function useFilters(bounds: FilterBounds) {
  const { pathname, search } = useLocation()
  const filters = useMemo(() => parseFilters(search, bounds), [search, bounds])
  const canonical = serializeFilters(filters)

  const setFilters = useCallback(
    (patch: Partial<Filters>) =>
      navigate(pathname, serializeFilters({ ...filters, ...patch }), { replace: true }),
    [pathname, filters],
  )

  return { filters, setFilters, canonical, isCanonical: search === canonical }
}
