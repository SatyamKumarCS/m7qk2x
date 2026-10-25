// Decision-view chart (FR-3.3): shaded planning band, hourly decision-time forecast and, once
// revealed, the half-hourly actual. Each series has its own data, so a missing value breaks
// its line (connectNulls=false) instead of being interpolated or drawn as zero.

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { ActualRow, ForecastRow } from '../utils/decision.ts'
import { formatPower } from '../utils/format.ts'
import { formatUkTime } from '../utils/time.ts'

const FORECAST = '#ff7f0e'
const ACTUAL = '#1f77b4'
const HOUR = 3_600_000

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

export function BandChart({ forecast, actual, level, revealed, domain }: Props) {
  const ticks = []
  for (let t = domain[0]; t <= domain[1]; t += 3 * HOUR) ticks.push(t)
  return (
    <div
      className="chart"
      role="img"
      aria-label={`Forecast with ${level}% planning band${revealed ? ' and actual' : ''}, UK time`}
    >
      <ResponsiveContainer width="100%" height={320}>
        <ComposedChart margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e4e7eb" />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={domain}
            ticks={ticks}
            tickFormatter={ukTick}
            allowDuplicatedCategory={false}
            fontSize={13}
          />
          <YAxis tickFormatter={powerTick} width={72} fontSize={13} />
          <Tooltip
            labelFormatter={(ms) => `${ukTick(Number(ms))} UK time`}
            formatter={(value, name) => [
              Array.isArray(value)
                ? `${formatPower(Number(value[0]))} – ${formatPower(Number(value[1]))}`
                : formatPower(Number(value)),
              name,
            ]}
          />
          <Legend wrapperStyle={{ fontSize: 13 }} />
          <Area
            data={forecast}
            dataKey="band"
            name={`${level}% planning band`}
            legendType="square"
            stroke="none"
            fill={FORECAST}
            fillOpacity={0.18}
            connectNulls={false}
            isAnimationActive={false}
          />
          <Line
            data={forecast}
            dataKey="forecast"
            name="Forecast at cutoff"
            stroke={FORECAST}
            strokeWidth={2}
            strokeDasharray="6 3"
            dot={{ r: 2 }}
            connectNulls={false}
            isAnimationActive={false}
          />
          {revealed && (
            <Line
              data={actual}
              dataKey="actual"
              name="Actual (metered)"
              stroke={ACTUAL}
              strokeWidth={2}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
