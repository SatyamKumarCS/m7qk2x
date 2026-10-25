// Accuracy report (PRD FR-3.9–3.12, UC-3, UC-4, UC-7, E-15, E-16): headline metrics, where the
// decision-time forecast is weak, how much data supports each number, and what the pipeline
// dropped. Every number comes from the API for the current filters.

import { api } from '../api/client.ts'
import type {
  BreakdownResponse,
  MetaResponse,
  MetricsResponse,
  TimeseriesResponse,
} from '../api/types.ts'
import { BreakdownChart, ErrorHistogram, LowSampleKey } from '../components/AccuracyCharts.tsx'
import { EmptyState, ErrorState, LoadingState } from '../components/States.tsx'
import { DATA_SCOPE_NOTE } from '../constants.ts'
import { type AsyncState, useAsync } from '../hooks/useAsync.ts'
import type { Filters } from '../hooks/useFilters.ts'
import {
  histogram,
  keyFindings,
  LOW_SAMPLE_N,
  lowSampleCount,
  METRIC_HELP,
  qualityRows,
} from '../utils/accuracy.ts'
import { formatCount, formatPercent, formatPower, formatSignedPower } from '../utils/format.ts'
import { daysInclusive, formatDate } from '../utils/time.ts'

interface Props {
  filters: Filters
  meta: AsyncState<MetaResponse>
  onRetryMeta: () => void
}

interface Report {
  metrics: MetricsResponse
  horizon: BreakdownResponse
  hour: BreakdownResponse
  level: BreakdownResponse
  day: BreakdownResponse
  series: TimeseriesResponse
}

export function AccuracyPage({ filters, meta, onRetryMeta }: Props) {
  const { start, end, cutoff } = filters
  const report = useAsync(`acc:${start}:${end}:${cutoff}`, async (signal): Promise<Report> => {
    const q = { start, end, cutoff }
    const [metrics, horizon, hour, level, day, series] = await Promise.all([
      api.metrics(q, signal),
      api.breakdown('horizon', q, signal),
      api.breakdown('hour', q, signal),
      api.breakdown('level', q, signal),
      api.breakdown('day', q, signal),
      api.timeseries(q, signal),
    ])
    return { metrics, horizon, hour, level, day, series }
  })
  const days = daysInclusive(start, end)

  return (
    <section className="page" aria-labelledby="page-title">
      <h1 id="page-title">Accuracy report</h1>
      <p className="page__intro">
        How wrong the decision-time forecast (published by <strong>{cutoff} UK time</strong> on the
        day before delivery) has been, {formatDate(start)} – {formatDate(end)} ({days}{' '}
        {days === 1 ? 'day' : 'days'}).
      </p>
      {report.state.status === 'loading' && (
        <LoadingState label="Loading the accuracy report…" lines={6} />
      )}
      {report.state.status === 'error' && (
        <ErrorState message={report.state.error} onRetry={report.retry} />
      )}
      {report.state.status === 'success' && <ReportBody report={report.state.data} />}
      <QualityFooter meta={meta} onRetry={onRetryMeta} report={report.state} />
    </section>
  )
}

function ReportBody({ report }: { report: Report }) {
  const { metrics, horizon, hour, level, day, series } = report
  const { metrics: m, counts } = metrics
  if (counts.n === 0) {
    return (
      <EmptyState title="No hours with both a forecast and an actual in this range.">
        <p className="muted">
          {counts.missingForecast} hour(s) have no forecast at this cutoff and{' '}
          {counts.missingActual} have no actual. Try a wider range or an earlier-published cutoff.
        </p>
      </EmptyState>
    )
  }
  const errors = series.points
    .filter((p) => p.evaluated && p.error !== null)
    .map((p) => p.error as number)
  const findings = keyFindings({
    metrics,
    horizon: horizon.groups,
    level: level.groups,
    hour: hour.groups,
    errors,
  })
  const lowDays = lowSampleCount(day.groups)

  return (
    <>
      {counts.n < LOW_SAMPLE_N && (
        <p className="notice" role="note">
          Only {counts.n} hourly points in this range (fewer than {LOW_SAMPLE_N}): treat these
          numbers as indicative.
        </p>
      )}
      <dl className="kpis kpis--six" aria-label="Accuracy metrics">
        <Card label="Mean absolute error (MAE)" value={formatPower(m.mae)} help={METRIC_HELP.mae} />
        <Card label="RMSE" value={formatPower(m.rmse)} help={METRIC_HELP.rmse} />
        <Card label="P90 absolute error" value={formatPower(m.p90Abs)} help={METRIC_HELP.p90Abs} />
        <Card label="nMAE" value={formatPercent(m.nmae)} help={METRIC_HELP.nmae} />
        <Card
          label="Hours compared (n)"
          value={formatCount(counts.n)}
          help={`${METRIC_HELP.n} ${counts.missingForecast} without forecast · ${counts.missingActual} without actual.`}
        />
        <div className="kpi kpi--bias">
          <dt>Bias (forecast − actual)</dt>
          <dd>
            <span className="kpi__value">{formatSignedPower(m.bias)}</span>
            <span className="kpi__note">{METRIC_HELP.bias}</span>
            <span className="kpi__note">Cause not known. {DATA_SCOPE_NOTE}</span>
          </dd>
        </div>
      </dl>

      <section aria-labelledby="findings-title" className="findings">
        <h2 id="findings-title">Key findings</h2>
        {findings.length ? (
          <ol>
            {findings.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ol>
        ) : (
          <p className="muted">Not enough data in this range for findings.</p>
        )}
      </section>

      <h2>Where the forecast is weak</h2>
      <LowSampleKey />
      <div className="breakdowns">
        <BreakdownChart
          title="Error by forecast horizon"
          description={`Hours between publication and delivery, over every forecast run (the cutoff does not apply). ${horizon.note ?? ''}`}
          groups={horizon.groups}
          groupHeader="Horizon (h ahead)"
          format={(g) => `${g} h`}
          showN
        />
        <BreakdownChart
          title="Error by hour of day"
          description="UK clock hour of delivery, at the selected cutoff."
          groups={hour.groups}
          groupHeader="UK hour"
          format={(g) => `${g}:00`}
        />
        <BreakdownChart
          title="Error by wind level"
          description="Grouped by metered (actual) wind, as specified. Grouping by actual exaggerates the low-wind error (regression to the mean)."
          groups={level.groups}
          groupHeader="Metered wind level"
          showN
        />
        <BreakdownChart
          title="Daily MAE"
          description={`One bar per UK delivery day. ${lowDays} of ${day.groups.length} days have fewer than ${LOW_SAMPLE_N} hours, so look at the pattern, not single days.`}
          groups={day.groups}
          groupHeader="Delivery day"
          format={(g) => formatDate(g).replace(/ \d{4}$/, '')}
        />
        <ErrorHistogram bins={histogram(errors)} total={errors.length} />
      </div>
    </>
  )
}

function Card({ label, value, help }: { label: string; value: string; help: string }) {
  return (
    <div className="kpi">
      <dt>{label}</dt>
      <dd>
        <span className="kpi__value">{value}</span>
        <span className="kpi__note">{help}</span>
      </dd>
    </div>
  )
}

function QualityFooter({
  meta,
  onRetry,
  report,
}: {
  meta: AsyncState<MetaResponse>
  onRetry: () => void
  report: AsyncState<Report>
}) {
  return (
    <section className="quality" aria-labelledby="quality-title">
      <h2 id="quality-title">Data quality</h2>
      {meta.status === 'loading' && <LoadingState label="Loading the quality report…" lines={2} />}
      {meta.status === 'error' && (
        <ErrorState message={`Quality report unavailable: ${meta.error}`} onRetry={onRetry} />
      )}
      {meta.status === 'success' && <QualityTables meta={meta.data} />}
      {report.status === 'success' && (
        <p className="muted">
          This report uses {formatCount(report.data.metrics.counts.n)} hourly points;{' '}
          {report.data.metrics.counts.missingForecast} hour(s) had no forecast published by the
          cutoff and {report.data.metrics.counts.missingActual} had no actual. Missing hours are
          left out, never counted as zero.
        </p>
      )}
    </section>
  )
}

function QualityTables({ meta }: { meta: MetaResponse }) {
  const { actuals, forecasts } = qualityRows(meta.quality)
  return (
    <div className="quality__grid">
      <table className="data-table">
        <caption>
          Actuals (FUELHH WIND): {formatCount(actuals.kept)} of {formatCount(actuals.expected)}{' '}
          half-hours kept
        </caption>
        <tbody>
          {actuals.excluded.map((r) => (
            <tr key={r.label}>
              <th scope="row">{r.label}</th>
              <td>{formatCount(r.count)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <table className="data-table">
        <caption>
          Forecasts (WINDFOR): {formatCount(forecasts.kept)} hourly values from{' '}
          {formatCount(forecasts.runs)} runs kept
        </caption>
        <tbody>
          {forecasts.excluded.map((r) => (
            <tr key={r.label}>
              <th scope="row">{r.label}</th>
              <td>{formatCount(r.count)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
