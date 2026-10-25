// Route target for the Accuracy report view. Its content arrives with that ticket; until then
// it shows the filters it will use.

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

export function AccuracyPage({ filters }: { filters: Filters }) {
  return (
    <Page
      title="Accuracy report"
      intro="How wrong the decision-time forecast has been, and where it is weakest."
      uses={`${formatDate(filters.start)} – ${formatDate(filters.end)}, cutoff ${filters.cutoff} UK time.`}
    />
  )
}
