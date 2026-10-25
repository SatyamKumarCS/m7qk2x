// Development fixtures (VITE_API_MOCK=1) shaped exactly like spec §5, so the shell can be built
// before the Backend API exists. Only health and meta are mocked; every other endpoint fails
// clearly instead of returning invented numbers.

import type { HealthResponse, MetaResponse } from './types.ts'

const HEALTH: HealthResponse = {
  status: 'ok',
  dataLoaded: true,
  actualsRows: 1536,
  forecastRows: 15775,
  dataRange: { start: '2026-01-02', end: '2026-02-01' },
}

const META: MetaResponse = {
  scope: { deliveryStart: '2026-01-02', deliveryEnd: '2026-02-01' },
  defaultCutoff: '09:20',
  cutoffPresets: [
    { label: 'EPEX GB', value: '09:20' },
    { label: 'N2EX', value: '09:50' },
    { label: 'Early', value: '06:00' },
  ],
  publishSchedule: ['02:30', '04:30', '07:30', '09:30', '11:30', '15:30', '18:30', '22:30'],
  forecastResolutionMinutes: 60,
  assumptions: [
    '(mock) Decisions are made in January 2026, so delivery days run from 2 January to 1 February.',
    '(mock) The forecast used is the latest one published at or before the cutoff on the day before delivery.',
  ],
  quality: {
    inputs: [],
    actuals: {
      rows: 1536,
      expected: 1536,
      missingSlots: [],
      duplicates: 0,
      revisionsCollapsed: 0,
      nonWindDropped: 0,
      nulls: 0,
      negatives: 0,
      spikes: 0,
      spikeTimes: [],
      startTimeRange: ['2026-01-01T00:00:00Z', '2026-02-01T23:30:00Z'],
      generationRangeMw: [1695, 17805],
      resolutionMinutes: 30,
    },
    forecasts: {
      rows: 15775,
      runs: 272,
      runsPerPublishDay: { '8': 34 },
      publishClockTimes: {},
      duplicates: 0,
      conflictingDuplicates: 0,
      droppedPublishedAfterTarget: 4081,
      nulls: 0,
      negatives: 0,
      spikes: 0,
      spikeTimes: [],
      publishTimeRange: ['2025-12-29T02:30:00Z', '2026-01-31T22:30:00Z'],
      startTimeRange: ['2025-12-29T03:00:00Z', '2026-02-02T21:00:00Z'],
      horizonRangeH: [0.5, 66.5],
      generationRangeMw: [2292, 21353],
      resolutionMinutes: 60,
    },
  },
  sources: [],
  version: 'mock',
}

export async function mockResponse<T>(path: string): Promise<T> {
  await new Promise((resolve) => setTimeout(resolve, 150))
  if (path === '/api/health') return HEALTH as T
  if (path === '/api/meta') return META as T
  throw new Error(`${path} is not available in mock mode; it arrives with the Backend API.`)
}
