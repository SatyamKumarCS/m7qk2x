// Decision-view chart (FR-3.3): shaded planning band, hourly decision-time forecast and, once
// revealed, the half-hourly actual. Each series has its own data, so a missing value breaks
// its line (connectNulls=false) instead of being interpolated or drawn as zero.

import { Fragment } from 'react'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  type TooltipContentProps,
  XAxis,
  YAxis,
} from 'recharts'
import type { ActualRow, ForecastRow } from '../utils/decision.ts'
import { formatPower } from '../utils/format.ts'
import { formatUkTime } from '../utils/time.ts'

const FORECAST = '#ff7f0e'
const ACTUAL = '#1f77b4'
const HOUR = 3_600_000
const SERIES_COLOR: Record<string, string> = { band: FORECAST, forecast: FORECAST, actual: ACTUAL }

interface Props {
  forecast: ForecastRow[]
  actual: ActualRow[]
  level: number
  revealed: boolean
  domain: [number, number] // epoch ms: start of the day, end of the day
}

const ukTick = (ms: number) => formatUkTime(new Date(ms).toISOString())
// Same rule as everywhere else (FR-3.15): GW to 1 dp from 1,000 MW, so 4.5 GW never reads "5 GW".
const powerTick = (mw: number) => formatPower(mw)

function BandTooltip({ active, payload, label }: TooltipContentProps) {
  if (!active || !payload?.length) return null
  return (
    <div className="chart-tooltip">
      <p className="chart-tooltip__time">{ukTick(Number(label))} UK time</p>
      <dl>
        {payload.map((p) => {
          const value = p.value
          return (
            <Fragment key={String(p.dataKey)}>
              <dt>
                <span className="dot" style={{ background: SERIES_COLOR[String(p.dataKey)] }} />
                {p.name}
              </dt>
              <dd>
                {Array.isArray(value)
                  ? `${formatPower(Number(value[0]))} – ${formatPower(Number(value[1]))}`
                  : formatPower(Number(value))}
              </dd>
            </Fragment>
          )
        })}
      </dl>
    </div>
  )
}

/** The highest and lowest hour that has a forecast, marked on the line. */
function extremes(rows: ForecastRow[]) {
  const withValue = rows.filter((r) => r.forecast !== null)
  if (withValue.length < 2) return null
  const by = (better: (a: number, b: number) => boolean) =>
    withValue.reduce((best, r) => (better(r.forecast!, best.forecast!) ? r : best))
  const peak = by((a, b) => a > b)
  const trough = by((a, b) => a < b)
  return peak.t === trough.t ? null : { peak, trough }
}

export function BandChart({ forecast, actual, level, revealed, domain }: Props) {
  const ticks = []
  for (let t = domain[0]; t <= domain[1]; t += 3 * HOUR) ticks.push(t)
  const marks = extremes(forecast)
  // Labels sit beside the dot, towards the middle of the day, so they never hit an axis edge.
  const side = (t: number) => (t > (domain[0] + domain[1]) / 2 ? 'left' : 'right')
  return (
    <div className="chart-card">
      <div
        className="chart"
        role="img"
        aria-label={`Forecast with ${level}% planning band${revealed ? ' and actual' : ''}, UK time`}
      >
        <ResponsiveContainer width="100%" height={340}>
          <ComposedChart margin={{ top: 16, right: 20, bottom: 4, left: 4 }}>
            <defs>
              <linearGradient id="band-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={FORECAST} stopOpacity={0.38} />
                <stop offset="100%" stopColor={FORECAST} stopOpacity={0.1} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="2 5" stroke="var(--chart-grid)" vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={domain}
              ticks={ticks}
              tickFormatter={ukTick}
              allowDuplicatedCategory={false}
              fontSize={13}
              tickLine={false}
              axisLine={{ stroke: 'var(--chart-axis)' }}
              tickMargin={8}
            />
            <YAxis
              tickFormatter={powerTick}
              width={72}
              fontSize={13}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              cursor={{ stroke: 'var(--chart-accent)', strokeWidth: 1, strokeDasharray: '3 3' }}
              content={(p) => <BandTooltip {...p} />}
            />
            <Area
              data={forecast}
              dataKey="band"
              name={`${level}% planning band`}
              stroke="none"
              fill="url(#band-fill)"
              connectNulls={false}
              isAnimationActive={false}
            />
            <Line
              data={forecast}
              dataKey="forecast"
              name="Forecast at cutoff"
              stroke={FORECAST}
              strokeWidth={2.5}
              strokeDasharray="6 3"
              dot={{ r: 3, strokeWidth: 2, stroke: 'var(--color-surface)', fill: FORECAST }}
              activeDot={{ r: 6, strokeWidth: 2, stroke: 'var(--color-surface)' }}
              connectNulls={false}
              isAnimationActive={false}
            />
            {revealed && (
              <Line
                data={actual}
                dataKey="actual"
                name="Actual (metered)"
                stroke={ACTUAL}
                strokeWidth={3}
                dot={false}
                activeDot={{ r: 6, strokeWidth: 2, stroke: 'var(--color-surface)' }}
                connectNulls={false}
                isAnimationActive={false}
              />
            )}
            {marks && (
              <>
                <ReferenceDot
                  x={marks.peak.t}
                  y={marks.peak.forecast!}
                  r={7}
                  fill="var(--color-surface)"
                  stroke="var(--chart-accent)"
                  strokeWidth={3}
                  label={{
                    value: 'Peak',
                    position: side(marks.peak.t),
                    fontSize: 12,
                    fill: 'var(--chart-accent)',
                  }}
                />
                <ReferenceDot
                  x={marks.trough.t}
                  y={marks.trough.forecast!}
                  r={7}
                  fill="var(--color-surface)"
                  stroke="var(--chart-accent)"
                  strokeWidth={3}
                  label={{
                    value: 'Trough',
                    position: side(marks.trough.t),
                    fontSize: 12,
                    fill: 'var(--chart-accent)',
                  }}
                />
              </>
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <ul className="legend legend--chips" aria-label="Chart key">
        <li>
          <span className="swatch swatch--box" style={{ background: FORECAST, opacity: 0.35 }} />
          {level}% planning band
        </li>
        <li>
          <span className="swatch swatch--dashed" style={{ borderColor: FORECAST }} />
          Forecast at cutoff
        </li>
        {revealed && (
          <li>
            <span className="swatch swatch--line" style={{ borderColor: ACTUAL }} />
            Actual (metered)
          </li>
        )}
      </ul>
    </div>
  )
}
