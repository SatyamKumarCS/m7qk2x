import type { MouseEvent } from 'react'
import { navigate } from '../hooks/useLocation.ts'

export interface Tab {
  path: string
  label: string
}

export function TopBar({
  tabs,
  activePath,
  onOpenAbout,
}: {
  tabs: Tab[]
  activePath: string
  onOpenAbout: () => void
}) {
  const follow = (path: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
    event.preventDefault()
    navigate(path) // keeps the query string, so filters survive tab changes
  }

  return (
    <header className="topbar">
      <div className="topbar__brand">
        <span className="topbar__title">Wind Forecast Monitor</span>
        <span className="topbar__subtitle">GB wind forecast vs actual, decisions in Jan 2026</span>
      </div>
      <nav className="tabs" aria-label="Views">
        {tabs.map((tab) => (
          <a
            key={tab.path}
            href={tab.path + window.location.search}
            className="tabs__tab"
            aria-current={tab.path === activePath ? 'page' : undefined}
            onClick={follow(tab.path)}
          >
            {tab.label}
          </a>
        ))}
      </nav>
      <button type="button" className="button button--ghost" onClick={onOpenAbout}>
        About this data
      </button>
    </header>
  )
}
