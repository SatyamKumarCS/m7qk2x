// Accuracy report charts (FR-3.10, E-16): MAE per breakdown group with low-sample groups greyed
// and labelled, and a histogram of signed error (red = forecast too high, blue = too low). Each
// chart has a table equivalent so the numbers are readable without the picture.

import {
  Bar,
  type BarShapeProps,
  BarChart,
  CartesianGrid,
  LabelList,
  Rectangle,
  ResponsiveContainer,
  Tooltip,
  type TooltipContentProps,
  XAxis,
  YAxis,
} from 'recharts'
import type { BreakdownGroup } from '../api/types.ts'
import { binLabel, type HistogramBin, LOW_SAMPLE_N } from '../utils/accuracy.ts'
import { formatCount, formatPower, formatSignedPower } from '../utils/format.ts'

const COLORS = { mae: 'var(--chart-bar-to)', low: '#b8c0c8', over: '#d62728', under: '#1f77b4' }

function MaeShape(props: BarShapeProps) {
  const group = props.payload as BreakdownGroup
  return (
    <Rectangle
      {...props}
      radius={[6, 6, 0, 0]}
      fill={group.lowSample ? COLORS.low : 'url(#mae-fill)'}
    />
  )
}

function HistogramShape(props: BarShapeProps) {
  const bin = props.payload as HistogramBin
  return (
    <Rectangle {...props} radius={[3, 3, 0, 0]} fill={bin.lo >= 0 ? COLORS.over : COLORS.under} />
  )
}

function GroupTooltip({
  active,
  payload,
  format,
}: TooltipContentProps & { format: (g: string) => string }) {
  if (!active || !payload?.length) return null
  const g = payload[0].payload as BreakdownGroup
  return (
    <div className="chart-tooltip">
      <p className="chart-tooltip__time">{format(g.group)}</p>
      <dl>
        <dt>MAE</dt>
        <dd>{formatPower(g.mae)}</dd>
        <dt>Bias</dt>
        <dd>{formatSignedPower(g.bias)}</dd>
        <dt>P90 abs. error</dt>
        <dd>{formatPower(g.p90)}</dd>
        <dt>Hours (n)</dt>
        <dd>
          {formatCount(g.n)}
          {g.lowSample ? ' – low sample' : ''}
        </dd>
      </dl>
    </div>
  )
}

/** Group name with its n underneath (and "low" below that), kept short for phone widths. */
function NTick(props: {
  x?: number
  y?: number
  payload?: { value: string; index: number }
  groups: BreakdownGroup[]
}) {
  const { x = 0, y = 0, payload, groups } = props
  if (!payload) return null
  const g = groups[payload.index]
  return (
    <text x={x} y={y + 12} textAnchor="middle" fontSize={11} fill="var(--color-text)">
      <tspan x={x}>{payload.value}</tspan>
      <tspan x={x} dy={14} fill="var(--color-muted)">
        n {formatCount(g?.n)}
      </tspan>
      {g?.lowSample && (
        <tspan x={x} dy={14} fill="var(--color-muted)">
          low
        </tspan>
      )}
    </text>
  )
}

/** Red when the forecast ran high, blue when it ran low; text always carries the sign too. */
const biasClass = (bias: number | null) =>
  bias === null || bias === 0 ? undefined : bias > 0 ? 'is-over' : 'is-under'

interface BreakdownProps {
  title: string
  description: string
  groups: BreakdownGroup[]
  groupHeader: string
  format?: (group: string) => string
  showN?: boolean
}

export function BreakdownChart({
  title,
  description,
  groups,
  groupHeader,
  format = (g) => g,
  showN = false,
}: BreakdownProps) {
  const maxMae = Math.max(0, ...groups.map((g) => g.mae ?? 0))
  return (
    <figure className="breakdown">
      <figcaption>
        <h3>{title}</h3>
        <p className="muted">{description}</p>
      </figcaption>
      <div className="chart" role="img" aria-label={`${title}: mean absolute error per group`}>
        <ResponsiveContainer width="100%" height={showN ? 265 : 230}>
          <BarChart data={groups} margin={{ top: 8, right: 16, bottom: showN ? 34 : 0, left: 8 }}>
            <defs>
              <linearGradient id="mae-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-bar-from)" />
                <stop offset="100%" stopColor="var(--chart-bar-to)" />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="2 5" stroke="var(--chart-grid)" vertical={false} />
            <XAxis
              dataKey="group"
              interval={showN ? 0 : 'preserveStartEnd'}
              tick={showN ? <NTick groups={groups} /> : { fontSize: 12 }}
              tickFormatter={showN ? undefined : format}
            />
            <YAxis
              tickFormatter={(v: number) => formatPower(v)}
              width={72}
              fontSize={13}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              cursor={{ fill: 'rgb(18 74 56 / 6%)' }}
              content={(p) => <GroupTooltip {...p} format={format} />}
            />
            <Bar dataKey="mae" name="MAE" shape={MaeShape} isAnimationActive={false}>
              {groups.length <= 8 && (
                <LabelList
                  dataKey="mae"
                  position="top"
                  fontSize={12}
                  fontWeight={600}
                  fill="var(--chart-accent)"
                  formatter={(v: unknown) => formatPower(Number(v))}
                />
              )}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <details className="table-toggle">
        <summary>
          {title} (table, {groups.length} rows)
        </summary>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">{groupHeader}</th>
                <th scope="col">Hours (n)</th>
                <th scope="col">MAE</th>
                <th scope="col">RMSE</th>
                <th scope="col">Bias</th>
                <th scope="col">P90 abs. error</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.group} className={g.lowSample ? 'is-low-sample' : undefined}>
                  <th scope="row">
                    {format(g.group)}
                    {g.lowSample ? ' (low sample)' : ''}
                  </th>
                  <td>{formatCount(g.n)}</td>
                  <td className="cell-bar">
                    <span
                      className="cell-bar__fill"
                      style={{ width: `${maxMae > 0 ? ((g.mae ?? 0) / maxMae) * 100 : 0}%` }}
                    />
                    <span className="cell-bar__text">{formatPower(g.mae)}</span>
                  </td>
                  <td>{formatPower(g.rmse)}</td>
                  <td className={biasClass(g.bias)}>{formatSignedPower(g.bias)}</td>
                  <td>{formatPower(g.p90)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  )
}

export function ErrorHistogram({ bins, total }: { bins: HistogramBin[]; total: number }) {
  return (
    <figure className="breakdown">
      <figcaption>
        <h3>Spread of signed error</h3>
        <p className="muted">
          Hours per 0.5 GW error bin, {formatCount(total)} hours. Red bins: the forecast was too
          high; blue: too low.
        </p>
      </figcaption>
      <div className="chart" role="img" aria-label="Histogram of forecast minus actual, per hour">
        <ResponsiveContainer width="100%" height={230}>
          <BarChart
            data={bins}
            barCategoryGap={1}
            margin={{ top: 8, right: 16, bottom: 0, left: 8 }}
          >
            <CartesianGrid strokeDasharray="2 5" stroke="var(--chart-grid)" vertical={false} />
            <XAxis
              dataKey="lo"
              tickFormatter={(v: number) => formatSignedPower(v)}
              interval="preserveStartEnd"
              fontSize={12}
            />
            <YAxis allowDecimals={false} width={48} fontSize={13} />
            <Tooltip
              cursor={{ fill: 'rgb(18 74 56 / 6%)' }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const bin = payload[0].payload as HistogramBin
                return (
                  <div className="chart-tooltip">
                    <p className="chart-tooltip__time">{binLabel(bin)}</p>
                    <p>{formatCount(bin.count)} hours</p>
                  </div>
                )
              }}
            />
            <Bar dataKey="count" name="Hours" shape={HistogramShape} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </figure>
  )
}

/** Legend shared by the breakdown charts. */
export function LowSampleKey() {
  return (
    <ul className="legend legend--chips" aria-label="Chart key">
      <li>
        <span className="swatch swatch--box" style={{ background: COLORS.mae }} /> MAE per group
      </li>
      <li>
        <span className="swatch swatch--box" style={{ background: COLORS.low }} /> Grey = low
        sample: fewer than {LOW_SAMPLE_N} hours, so read it with care
      </li>
    </ul>
  )
}
