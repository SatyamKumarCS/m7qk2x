// Route targets for the three views. Their content arrives with the Decision, Explorer and
// Accuracy report tickets; until then each shows the filters it will use.

import { EmptyState } from '../components/States.tsx'
import type { Filters } from '../hooks/useFilters.ts'
import { formatDate } from '../utils/time.ts'

function Page({ title, intro, uses }: { title: string; intro: string; uses: string }) {
  return (
    <section className="page" aria-labelledby="page-title">
      <h1 id="page-title">{title}</h1>
      <p className="page__intro">{intro}</p>
      <EmptyState title="This view is not built yet.">
        <p className="muted">It will use: {uses}</p>
      </EmptyState>
    </section>
  )
}

export function DecisionPage({ filters }: { filters: Filters }) {
  return (
    <Page
      title="Decision view"
      intro="The wind forecast you had at the cutoff for one delivery day, with a planning band."
      uses={`delivery day ${formatDate(filters.date)}, cutoff ${filters.cutoff} UK time, ${filters.band}% band.`}
    />
  )
}

export function ExplorerPage({ filters }: { filters: Filters }) {
  return (
    <Page
      title="Forecast vs actual"
      intro="Decision-time forecast against actual wind over a date range."
      uses={`${formatDate(filters.start)} – ${formatDate(filters.end)}, cutoff ${filters.cutoff} UK time.`}
    />
  )
}

export function AccuracyPage({ filters }: { filters: Filters }) {
  return (
    <Page
      title="Accuracy report"
      intro="How wrong the decision-time forecast has been, and where it is weakest."
      uses={`${formatDate(filters.start)} – ${formatDate(filters.end)}, cutoff ${filters.cutoff} UK time.`}
    />
  )
}
