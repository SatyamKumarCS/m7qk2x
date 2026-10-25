// Decision view (PRD FR-3.1–3.4, ADR 0009): the forecast the buyer had at the cutoff for one
// delivery day, its planning band and, on request, how it turned out.

import { type ReactNode, useCallback, useState } from 'react'
import { api } from '../api/client.ts'
import type { BandResponse, TimeseriesResponse } from '../api/types.ts'
import { BandChart } from '../components/BandChart.tsx'
import { DayPicker } from '../components/DayPicker.tsx'
import { EmptyState, ErrorState, LoadingState } from '../components/States.tsx'
import { BAND_LEVELS, type BandLevel } from '../constants.ts'
import { useAsync } from '../hooks/useAsync.ts'
import type { FilterBounds, Filters } from '../hooks/useFilters.ts'
import { bandLabel, biasText, buildSeries, dayKpis, verdict } from '../utils/decision.ts'
import {
  formatCount,
  formatEnergy,
  formatHours,
  formatPercent,
  formatPower,
} from '../utils/format.ts'
import { addDays, formatDate, formatUkDateTime, formatUkTime } from '../utils/time.ts'

interface Props {
  filters: Filters
  bounds: FilterBounds
  onChange: (patch: Partial<Filters>) => void
}

export function DecisionPage({ filters, bounds, onChange }: Props) {
  const { date, cutoff, band: level } = filters
  const band = useAsync(`band:${date}:${cutoff}:${level}`, (signal) =>
    api.band(date, cutoff, level, signal),
  )
  const series = useAsync(`ts:${date}:${cutoff}`, (signal) =>
    api.timeseries({ start: date, end: date, cutoff }, signal),
  )
  const retry = useCallback(() => {
    if (band.state.status === 'error') band.retry()
    if (series.state.status === 'error') series.retry()
  }, [band, series])

  return (
    <section className="page" aria-labelledby="page-title">
      <h1 id="page-title">Decision view</h1>
      <p className="page__intro">
        The wind forecast available at <strong>{cutoff} UK time</strong> on{' '}
        {formatDate(addDays(date, -1))} (the day before delivery), with a planning band.
      </p>
      <div className="decision__controls">
        <DayPicker
          value={date}
          min={bounds.start}
          max={bounds.end}
          onChange={(d) => onChange({ date: d })}
        />
        <div className="segmented" role="group" aria-label="Planning band level">
          {BAND_LEVELS.map((l) => (
            <button
              key={l}
              type="button"
              className="segmented__option"
              aria-pressed={l === level}
              onClick={() => onChange({ band: l as BandLevel })}
            >
              {l}% band
            </button>
          ))}
        </div>
      </div>

      {band.state.status === 'error' || series.state.status === 'error' ? (
        <ErrorState
          message={
            band.state.status === 'error'
              ? band.state.error
              : (series.state as { error: string }).error
          }
          onRetry={retry}
        />
      ) : band.state.status === 'loading' || series.state.status === 'loading' ? (
        <LoadingState label="Loading the decision-time forecast…" lines={5} />
      ) : (
        <DayView key={`${date}:${cutoff}`} band={band.state.data} series={series.state.data} />
      )}
    </section>
  )
}

function DayView({ band, series }: { band: BandResponse; series: TimeseriesResponse }) {
  const [revealed, setRevealed] = useState(false)
  const { summary } = band
  if (!band.points.some((p) => p.forecast !== null)) {
    return (
      <EmptyState title="No forecast was published before the cutoff for this day.">
        <p className="muted">
          Hours without a forecast at the cutoff are left empty, never filled in.
        </p>
      </EmptyState>
    )
  }
  const kpis = dayKpis(band, series)
  const { forecast, actual } = buildSeries(band, series)
  const first = Date.parse(series.points[0]?.startTime ?? band.points[0].startTime)
  const domain: [number, number] = [first, first + series.points.length * 1_800_000]
  const missingForecast = summary.points - summary.forecastHours

  return (
    <>
      <dl className="kpis" aria-label="Forecast summary">
        <Kpi label="Forecast energy" value={formatEnergy(summary.forecastMwh)}>
          {summary.forecastMwh !== null && `${formatCount(summary.forecastMwh)} MWh · `}
          over {summary.forecastHours} of {summary.points} h
        </Kpi>
        <Kpi label="Peak" value={formatPower(kpis.peak?.mw)}>
          {kpis.peak && `at ${formatUkTime(kpis.peak.at)} UK time`}
        </Kpi>
        <Kpi label="Trough" value={formatPower(kpis.trough?.mw)}>
          {kpis.trough && `at ${formatUkTime(kpis.trough.at)} UK time`}
        </Kpi>
        <Kpi
          label="Forecast published"
          value={kpis.publishTimes.length ? formatUkDateTime(kpis.publishTimes[0]) : '–'}
        >
          {kpis.publishTimes.length > 1
            ? `and ${kpis.publishTimes.length - 1} later run(s), UK time`
            : 'UK time'}
        </Kpi>
        <Kpi
          label="Horizon"
          value={
            kpis.horizon ? `${formatHours(kpis.horizon[0])} – ${formatHours(kpis.horizon[1])}` : '–'
          }
        >
          ahead of each hour
        </Kpi>
      </dl>

      <p className="band-label">
        {band.reason ? `No planning band: ${band.reason}` : bandLabel(band)}
      </p>
      <BandChart
        forecast={forecast}
        actual={actual}
        level={band.level}
        revealed={revealed}
        domain={domain}
      />
      <ul className="caveats">
        <li>{summary.notes.scope}</li>
        {missingForecast > 0 && (
          <li>
            {missingForecast} of {summary.points} hours have no forecast at this cutoff; they are
            shown as gaps.
          </li>
        )}
      </ul>

      <div className="reveal">
        <button
          type="button"
          className="button"
          aria-pressed={revealed}
          onClick={() => setRevealed((r) => !r)}
        >
          {revealed ? 'Hide actual' : 'Reveal actual'}
        </button>
        {revealed && <Outcome band={band} />}
      </div>

      <details className="table-toggle">
        <summary>Hourly values (table)</summary>
        <table className="data-table">
          <caption className="visually-hidden">
            Hourly forecast, planning band and actual, UK time
          </caption>
          <thead>
            <tr>
              <th scope="col">UK time</th>
              <th scope="col">Forecast</th>
              <th scope="col">Band ({band.level}%)</th>
              {revealed && <th scope="col">Actual</th>}
            </tr>
          </thead>
          <tbody>
            {band.points.map((p) => (
              <tr key={p.startTime}>
                <th scope="row">{formatUkTime(p.startTime)}</th>
                <td>{formatPower(p.forecast)}</td>
                <td>
                  {p.lower !== null && p.upper !== null
                    ? `${formatPower(p.lower)} – ${formatPower(p.upper)}`
                    : '–'}
                </td>
                {revealed && <td>{formatPower(p.actual)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </>
  )
}

function Outcome({ band }: { band: BandResponse }) {
  const { summary } = band
  const energy = summary.energyComparison
  return (
    <div className="outcome" aria-live="polite">
      <p className="outcome__verdict">{verdict(band)}</p>
      <dl className="kpis">
        <Kpi label="Mean absolute error" value={formatPower(summary.maeMw)}>
          over {summary.validPairs} hourly points
        </Kpi>
        <Kpi label="Bias (forecast − actual)" value={biasText(band)}>
          {summary.notes.bias} Data: operationally metered wind only.
        </Kpi>
        <Kpi
          label="Energy, forecast vs actual"
          value={
            energy
              ? `${formatEnergy(energy.forecastMwh)} vs ${formatEnergy(energy.actualMwh)}`
              : '–'
          }
        >
          {energy
            ? `over ${energy.hours} of ${summary.points} h (${formatPercent(energy.errorPct)} difference)`
            : 'no hour has both a forecast and a complete actual'}
        </Kpi>
      </dl>
    </div>
  )
}

function Kpi({ label, value, children }: { label: string; value: string; children?: ReactNode }) {
  return (
    <div className="kpi">
      <dt>{label}</dt>
      <dd>
        <span className="kpi__value">{value}</span>
        {children && <span className="kpi__note">{children}</span>}
      </dd>
    </div>
  )
}
