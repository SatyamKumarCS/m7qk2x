// Accuracy report overview: who was wrong in which direction, how often the miss stayed inside a
// few GW, and how the daily error moved. Everything is computed from the same hourly errors and
// daily breakdown the rest of the report uses, so no number here is new data.

import { Area, AreaChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts'
import type { BreakdownGroup } from '../api/types.ts'
import { formatCount, formatPower, formatShare } from '../utils/format.ts'
import { formatDate } from '../utils/time.ts'

const LIMITS_MW = [1000, 2000, 3000, 5000]
const COLORS = { over: '#d62728', under: '#1f77b4', exact: '#b8c0c8' }

interface Props {
  errors: number[] // signed hourly errors, forecast − actual, MW
  days: BreakdownGroup[] // one group per UK delivery day, group = YYYY-MM-DD
}

export function AccuracyHero({ errors, days }: Props) {
  const total = errors.length
  const over = errors.filter((e) => e > 0).length
  const under = errors.filter((e) => e < 0).length
  const exact = total - over - under
  const split = [
    { name: 'Forecast too high', value: over, color: COLORS.over },
    { name: 'Forecast too low', value: under, color: COLORS.under },
    ...(exact > 0 ? [{ name: 'Exactly right', value: exact, color: COLORS.exact }] : []),
  ]
  const overShare = total ? over / total : null
  const trend = days
    .filter((d) => d.mae !== null)
    .map((d) => ({ day: d.group, mae: d.mae as number }))

  return (
    <section className="hero-grid" aria-label="Accuracy at a glance">
      <article className="hero-card">
        <h3>Which way it misses</h3>
        <div className="donut">
          <div
            className="donut__chart"
            role="img"
            aria-label="Share of hours the forecast ran high or low"
          >
            <ResponsiveContainer width="100%" height={170}>
              <PieChart>
                <Pie
                  data={split}
                  dataKey="value"
                  innerRadius={54}
                  outerRadius={78}
                  paddingAngle={2}
                  cornerRadius={6}
                  stroke="none"
                  isAnimationActive={false}
                >
                  {split.map((s) => (
                    <Cell key={s.name} fill={s.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="donut__center">
              <strong>{formatShare(overShare, 0)}</strong>
              <span>ran high</span>
            </div>
          </div>
          <ul className="donut__legend">
            {split.map((s) => (
              <li key={s.name}>
                <span className="swatch swatch--box" style={{ background: s.color }} />
                <span>{s.name}</span>
                <strong>{formatCount(s.value)} h</strong>
              </li>
            ))}
          </ul>
        </div>
      </article>

      <article className="hero-card">
        <h3>How often the miss stays small</h3>
        <ul className="coverage">
          {LIMITS_MW.map((limit) => {
            const share = total ? errors.filter((e) => Math.abs(e) <= limit).length / total : 0
            return (
              <li key={limit}>
                <div className="coverage__row">
                  <span>Within {formatPower(limit)}</span>
                  <strong>{formatShare(share, 0)}</strong>
                </div>
                <div className="coverage__track" aria-hidden="true">
                  <div className="coverage__fill" style={{ width: `${share * 100}%` }} />
                </div>
              </li>
            )
          })}
        </ul>
        <p className="muted">Share of hours whose absolute error was at or under each limit.</p>
      </article>

      <article className="hero-card">
        <h3>Daily error trend</h3>
        <div className="spark" role="img" aria-label="Mean absolute error for each delivery day">
          <ResponsiveContainer width="100%" height={150}>
            <AreaChart data={trend} margin={{ top: 10, right: 6, bottom: 0, left: 6 }}>
              <defs>
                <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--chart-bar-from)" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="var(--chart-bar-from)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <XAxis dataKey="day" hide />
              <Tooltip
                cursor={{ stroke: 'var(--chart-accent)', strokeDasharray: '3 3' }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const p = payload[0].payload as { day: string; mae: number }
                  return (
                    <div className="chart-tooltip">
                      <p className="chart-tooltip__time">{formatDate(p.day)}</p>
                      <p>MAE {formatPower(p.mae)}</p>
                    </div>
                  )
                }}
              />
              <Area
                dataKey="mae"
                stroke="var(--chart-accent)"
                strokeWidth={2.5}
                fill="url(#spark-fill)"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <p className="muted">
          Mean absolute error per delivery day
          {trend.length > 1 &&
            `, ${formatDate(trend[0].day)} to ${formatDate(trend[trend.length - 1].day)}`}
          .
        </p>
      </article>
    </section>
  )
}
