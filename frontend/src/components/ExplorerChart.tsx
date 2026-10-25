// Explorer charts (FR-3.6–3.8): actual (solid) vs decision-time forecast (dashed) with a brush to
// zoom, and error bars underneath (red = forecast too high, blue = too low). Both charts share
// one row array and a syncId, so the brush and tooltip move them together. Missing values are
// null and break the lines (connectNulls=false).

import { useState } from 'react'
import {
  Bar,
  type BarShapeProps,
  Brush,
  CartesianGrid,
  ComposedChart,
  Line,
  Rectangle,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  type TooltipContentProps,
  XAxis,
  YAxis,
} from 'recharts'
import type { ExplorerRow } from '../utils/explorer.ts'
import { formatHours, formatPower, formatSignedPower } from '../utils/format.ts'
import { formatDate, formatUkDateTime, formatUkTime, ukDateOf } from '../utils/time.ts'

const COLORS = { actual: '#1f77b4', forecast: '#ff7f0e', over: '#d62728', under: '#1f77b4' }
const SYNC = 'explorer'

interface Props {
  rows: ExplorerRow[]
  downsampled: boolean
}

const iso = (t: number) => new Date(t).toISOString()

/** Ticks on real UK clock times: every 3 h for short windows, otherwise at UK midnights. */
function ticksFor(rows: ExplorerRow[]): number[] {
  if (rows.length < 2) return rows.map((r) => r.t)
  const spanDays = (rows[rows.length - 1].t - rows[0].t) / 86_400_000
  if (spanDays <= 2) {
    return rows
      .filter((r) => /^(00|03|06|09|12|15|18|21):00$/.test(formatUkTime(iso(r.t))))
      .map((r) => r.t)
  }
  const midnights = rows.filter((r) => formatUkTime(iso(r.t)) === '00:00').map((r) => r.t)
  const step = Math.max(1, Math.ceil(midnights.length / 8))
  return midnights.filter((_, i) => i % step === 0)
}

function tickLabel(t: number, short: boolean): string {
  const time = formatUkTime(iso(t))
  if (short && time !== '00:00') return time
  return formatDate(ukDateOf(iso(t))).replace(/ \d{4}$/, '') // "Thu, 15 Jan"
}

function ErrorShape(props: BarShapeProps) {
  const value = (props.payload as ExplorerRow).error ?? 0
  return <Rectangle {...props} fill={value > 0 ? COLORS.over : COLORS.under} />
}

function RowTooltip({
  active,
  payload,
  downsampled,
}: TooltipContentProps & { downsampled: boolean }) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload as ExplorerRow
  return (
    <div className="chart-tooltip">
      <p className="chart-tooltip__time">{formatUkDateTime(iso(row.t))} UK time</p>
      <dl>
        <dt>Actual{downsampled ? ' (hourly mean)' : ''}</dt>
        <dd>{formatPower(row.actual)}</dd>
        <dt>Forecast at cutoff</dt>
        <dd>{row.forecastHour ? formatPower(row.forecast) : '– (forecasts are hourly)'}</dd>
        <dt>Error (forecast − actual)</dt>
        <dd>{formatSignedPower(row.error)}</dd>
        <dt>Forecast published</dt>
        <dd>{row.publishTime ? `${formatUkDateTime(row.publishTime)} UK` : '–'}</dd>
        <dt>Horizon</dt>
        <dd>{row.horizonHours !== null ? `${formatHours(row.horizonHours)} ahead` : '–'}</dd>
      </dl>
    </div>
  )
}

export function ExplorerChart({ rows, downsampled }: Props) {
  const [view, setView] = useState<[number, number]>([0, rows.length - 1])
  const visible = rows.slice(view[0], view[1] + 1)
  const short = visible.length > 1 && visible[visible.length - 1].t - visible[0].t <= 2 * 86_400_000
  const ticks = ticksFor(visible)
  const xAxis = (hide = false) => (
    <XAxis
      dataKey="t"
      type="number"
      domain={['dataMin', 'dataMax']}
      ticks={ticks}
      tickFormatter={(t: number) => tickLabel(t, short)}
      fontSize={13}
      hide={hide}
    />
  )
  const tooltip = <Tooltip content={(p) => <RowTooltip {...p} downsampled={downsampled} />} />

  return (
    <div className="explorer-charts">
      <div
        className="chart"
        role="img"
        aria-label="Actual and decision-time forecast wind generation, UK time"
      >
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart
            data={rows}
            syncId={SYNC}
            margin={{ top: 8, right: 16, bottom: 0, left: 8 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e4e7eb" />
            {xAxis()}
            <YAxis tickFormatter={(v: number) => formatPower(v)} width={72} fontSize={13} />
            {tooltip}
            <Line
              dataKey="actual"
              name="Actual (metered)"
              stroke={COLORS.actual}
              strokeWidth={2}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
            <Line
              dataKey="forecastLine"
              name="Forecast at cutoff"
              stroke={COLORS.forecast}
              strokeWidth={2}
              strokeDasharray="6 3"
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
            <Brush
              dataKey="t"
              height={26}
              stroke="#1f6feb"
              tickFormatter={(t: number) => formatDate(ukDateOf(iso(t))).replace(/ \d{4}$/, '')}
              onChange={(range) => {
                if (range.startIndex !== undefined && range.endIndex !== undefined)
                  setView([range.startIndex, range.endIndex])
              }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div
        className="chart chart--errors"
        role="img"
        aria-label="Forecast error per hour: positive means the forecast was too high"
      >
        <ResponsiveContainer width="100%" height={150}>
          <ComposedChart
            data={rows}
            syncId={SYNC}
            margin={{ top: 8, right: 16, bottom: 0, left: 8 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e4e7eb" />
            {xAxis()}
            <YAxis tickFormatter={(v: number) => formatSignedPower(v)} width={72} fontSize={13} />
            {tooltip}
            <ReferenceLine y={0} stroke="#52606d" />
            <Bar
              dataKey="error"
              name="Error (forecast − actual)"
              shape={ErrorShape}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <ul className="legend" aria-label="Chart key">
        <li>
          <span className="swatch swatch--line" style={{ borderColor: COLORS.actual }} /> Actual
          (metered)
          {downsampled ? ', hourly mean' : ''}, solid line
        </li>
        <li>
          <span className="swatch swatch--dashed" style={{ borderColor: COLORS.forecast }} />{' '}
          Forecast at the cutoff, dashed line
        </li>
        <li>
          <span className="swatch swatch--gap" /> Gap = no data: a break in a line is never filled
          in
        </li>
        <li>
          <span className="swatch swatch--box" style={{ background: COLORS.over }} /> Error above
          zero: forecast too high ·{' '}
          <span className="swatch swatch--box" style={{ background: COLORS.under }} /> below zero:
          forecast too low
        </li>
      </ul>
    </div>
  )
}
