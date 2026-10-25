// Typed fetchers for the read-only API (docs/spec.md §5). The base URL comes from
// VITE_API_URL; when it is empty the app calls its own origin (the dev server proxies /api).

import type { BandLevel } from '../constants.ts'
import { mockResponse } from './mock.ts'
import type {
  BandResponse,
  BreakdownBy,
  BreakdownResponse,
  HealthResponse,
  MetaResponse,
  MetricsResponse,
  RangeQuery,
  TimeseriesResponse,
} from './types.ts'

const BASE_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '')
const USE_MOCK = import.meta.env.VITE_API_MOCK === '1'

/** A failed request. `status` is undefined for network errors. */
export class ApiError extends Error {
  readonly status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

type Params = Record<string, string | number>

async function getJson<T>(path: string, params: Params = {}, signal?: AbortSignal): Promise<T> {
  if (USE_MOCK) return mockResponse<T>(path)
  const query = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))
  const url = `${BASE_URL}${path}${query.size ? `?${query}` : ''}`
  let response: Response
  try {
    response = await fetch(url, { signal, headers: { Accept: 'application/json' } })
  } catch (err) {
    if (signal?.aborted) throw err
    throw new ApiError('Could not reach the server. Check your connection and try again.')
  }
  if (!response.ok) {
    let detail = `The server answered ${response.status}.`
    try {
      const body = (await response.json()) as { detail?: unknown }
      if (typeof body.detail === 'string') detail = body.detail // 422 messages (spec §5)
    } catch {
      // keep the generic message
    }
    throw new ApiError(detail, response.status)
  }
  return (await response.json()) as T
}

export const api = {
  health: (signal?: AbortSignal) => getJson<HealthResponse>('/api/health', {}, signal),
  meta: (signal?: AbortSignal) => getJson<MetaResponse>('/api/meta', {}, signal),
  timeseries: (q: RangeQuery, signal?: AbortSignal) =>
    getJson<TimeseriesResponse>('/api/timeseries', { ...q }, signal),
  metrics: (q: RangeQuery, signal?: AbortSignal) =>
    getJson<MetricsResponse>('/api/metrics', { ...q }, signal),
  breakdown: (by: BreakdownBy, q: RangeQuery, signal?: AbortSignal) =>
    getJson<BreakdownResponse>('/api/breakdown', { by, ...q }, signal),
  band: (date: string, cutoff: string, level: BandLevel, signal?: AbortSignal) =>
    getJson<BandResponse>('/api/band', { date, cutoff, level }, signal),
}
