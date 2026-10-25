// Explorer view (PRD FR-3.5–3.8, UC-2, E-24): decision-time forecast vs metered actual over any
// in-scope date range, with presets, zoom, error bars and visible gaps.

import { type SyntheticEvent, useCallback, useMemo, useState } from 'react'
import { api } from '../api/client.ts'
import type { MetricsResponse, TimeseriesResponse } from '../api/types.ts'
import { ExplorerChart } from '../components/ExplorerChart.tsx'
import { EmptyState, ErrorState, LoadingState } from '../components/States.tsx'
import { type AsyncState, useAsync } from '../hooks/useAsync.ts'
import type { FilterBounds, Filters } from '../hooks/useFilters.ts'
import {
  buildRows,
  DOWNSAMPLE_AFTER_DAYS,
  rangePresets,
  shouldDownsample,
  stormiestWeek,
} from '../utils/explorer.ts'
import { formatCount, formatHours, formatPower, formatSignedPower } from '../utils/format.ts'
import {
  daysInclusive,
  formatDate,
  formatUkDateTime,
  formatUkTime,
  ukDateOf,
} from '../utils/time.ts'

interface Props {
  filters: Filters
  bounds: FilterBounds
  onChange: (patch: Partial<Filters>) => void
}

const STORMIEST_RULE =
  'Stormiest week = the 7 consecutive delivery days with the highest average metered wind.'

export function ExplorerPage({ filters, bounds, onChange }: Props) {
  const { start, end, cutoff } = filters
  const query = { start, end, cutoff }
  const series = useAsync(`ts:${start}:${end}:${cutoff}`, (s) => api.timeseries(query, s))
  const metrics = useAsync(`m:${start}:${end}:${cutoff}`, (s) => api.metrics(query, s))
  // Actuals over the whole scope, only to find the stormiest week (cutoff-independent).
  const scope = useAsync(`scope:${bounds.start}:${bounds.end}`, (s) =>
    api.timeseries({ start: bounds.start, end: bounds.end, cutoff: bounds.defaultCutoff }, s),
  )
  const days = daysInclusive(start, end)

  return (
    <section className="page" aria-labelledby="page-title">
      <h1 id="page-title">Forecast vs actual</h1>
      <p className="page__intro">
        Decision-time forecast (published by <strong>{cutoff} UK time</strong> on the day before
        delivery) against metered actual wind, {formatDate(start)} – {formatDate(end)} ({days}{' '}
        {days === 1 ? 'day' : 'days'}).
      </p>
      <Presets bounds={bounds} filters={filters} scope={scope.state} onChange={onChange} />
      <Comparison metrics={metrics.state} onRetry={metrics.retry} />
      {series.state.status === 'loading' && (
        <LoadingState label="Loading forecast and actuals…" lines={6} />
      )}
      {series.state.status === 'error' && (
        <ErrorState message={series.state.error} onRetry={series.retry} />
      )}
      {series.state.status === 'success' && (
        <RangeView
          key={`${start}:${end}:${cutoff}`}
          data={series.state.data}
          start={start}
          end={end}
        />
      )}
    </section>
  )
}

function Presets({
  bounds,
  filters,
  scope,
  onChange,
}: {
  bounds: FilterBounds
  filters: Filters
  scope: AsyncState<TimeseriesResponse>
  onChange: (patch: Partial<Filters>) => void
}) {
  const presets = rangePresets(bounds.start, bounds.end)
  const stormiest = useMemo(
    () =>
      scope.status === 'success'
        ? stormiestWeek(scope.data.points, bounds.start, bounds.end, ukDateOf)
        : null,
    [scope, bounds.start, bounds.end],
  )
  const options = stormiest ? [...presets, stormiest] : presets
  const active = (p: { start: string; end: string }) =>
    p.start === filters.start && p.end === filters.end
  const short = (d: string) =>
    formatDate(d)
      .replace(/^\w+,? /, '')
      .replace(/ \d{4}$/, '') // "15 Jan"

  return (
    <div className="presets">
      <div className="segmented segmented--wrap" role="group" aria-label="Date range presets">
        {options.map((p) => (
          <button
            key={p.label}
            type="button"
            className="segmented__option"
            aria-pressed={active(p)}
            // Explicit name: the date span's leading space is dropped from computed names.
            aria-label={
              p.label === 'Whole January'
                ? p.label
                : `${p.label}, ${short(p.start)} to ${short(p.end)}`
            }
            onClick={() => onChange({ start: p.start, end: p.end })}
          >
            {p.label}
            {p.label !== 'Whole January' && (
              <span className="segmented__sub">
                {' '}
                {short(p.start)}–{short(p.end)}
              </span>
            )}
          </button>
        ))}
        {!stormiest && (
          <button type="button" className="segmented__option" disabled>
            Stormiest week {scope.status === 'loading' ? '(loading…)' : '(unavailable)'}
          </button>
        )}
      </div>
      <p className="muted">{STORMIEST_RULE}</p>
    </div>
  )
}

function Comparison({
  metrics,
  onRetry,
}: {
  metrics: AsyncState<MetricsResponse>
  onRetry: () => void
}) {
  if (metrics.status === 'loading')
    return <LoadingState label="Loading the comparison…" lines={1} />
  if (metrics.status === 'error') return <ErrorState message={metrics.error} onRetry={onRetry} />
  const { metrics: m, counts } = metrics.data
  return (
    <dl className="kpis" aria-label="Range comparison">
      <div className="kpi">
        <dt>Hours compared</dt>
        <dd>
          <span className="kpi__value">{formatCount(counts.n)}</span>
          <span className="kpi__note">
            {counts.missingForecast} without forecast · {counts.missingActual} without actual
          </span>
        </dd>
      </div>
      <div className="kpi">
        <dt>Mean absolute error</dt>
        <dd>
          <span className="kpi__value">{formatPower(m.mae)}</span>
          <span className="kpi__note">typical miss per hour</span>
        </dd>
      </div>
      <div className="kpi">
        <dt>Bias (forecast − actual)</dt>
        <dd>
          <span className="kpi__value">{formatSignedPower(m.bias)}</span>
          <span className="kpi__note">Cause not known; operationally metered wind only.</span>
        </dd>
      </div>
    </dl>
  )
}

function RangeView({ data, start, end }: { data: TimeseriesResponse; start: string; end: string }) {
  const downsampled = shouldDownsample(start, end)
  const rows = useMemo(() => buildRows(data.points, downsampled), [data, downsampled])
  const [tableOpen, setTableOpen] = useState(false)
  const onToggle = useCallback(
    (e: SyntheticEvent<HTMLDetailsElement>) => setTableOpen(e.currentTarget.open),
    [],
  )
  const hasData = data.points.some((p) => p.actual !== null || p.forecast !== null)
  if (!hasData) return <EmptyState title="No data for this range." />
  const missingActualHalfHours = data.points.filter((p) => p.actual === null).length
  const hourly = data.points.filter((p) => p.evaluated)

  return (
    <>
      <ExplorerChart rows={rows} downsampled={downsampled} />
      <ul className="caveats">
        {downsampled && (
          <li>
            Ranges longer than {DOWNSAMPLE_AFTER_DAYS} days are drawn at hourly resolution (actual =
            mean of the two half-hours) to stay fast; the numbers above are not affected. Drag the
            handles under the chart to zoom.
          </li>
        )}
        <li>
          Forecasts are hourly and compared with the actual half-hour that starts at the same time.
          {data.counts.missingForecast > 0 &&
            ` ${data.counts.missingForecast} hour(s) have no forecast at this cutoff.`}
          {missingActualHalfHours > 0 && ` ${missingActualHalfHours} half-hour(s) have no actual.`}{' '}
          Gaps are shown as breaks, never filled in.
        </li>
      </ul>
      <details className="table-toggle" onToggle={onToggle}>
        <summary>Hourly values (table, {hourly.length} rows)</summary>
        {tableOpen && (
          <table className="data-table">
            <caption className="visually-hidden">
              Hourly forecast, actual and error, UK time
            </caption>
            <thead>
              <tr>
                <th scope="col">UK time</th>
                <th scope="col">Actual</th>
                <th scope="col">Forecast</th>
                <th scope="col">Error</th>
                <th scope="col">Published</th>
                <th scope="col">Horizon</th>
              </tr>
            </thead>
            <tbody>
              {hourly.map((p) => (
                <tr key={p.startTime}>
                  <th scope="row">{formatUkDateTime(p.startTime)}</th>
                  <td>{formatPower(p.actual)}</td>
                  <td>{formatPower(p.forecast)}</td>
                  <td>{formatSignedPower(p.error)}</td>
                  <td>{p.publishTime ? formatUkTime(p.publishTime) : '–'}</td>
                  <td>{formatHours(p.horizonHours)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </details>
    </>
  )
}
