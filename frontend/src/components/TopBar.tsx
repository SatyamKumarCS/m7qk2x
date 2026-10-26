import type { MouseEvent, ReactNode } from 'react'
import { navigate } from '../hooks/useLocation.ts'

export interface Tab {
  path: string
  label: string
  hint: string
}

const ICON = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const

// One icon per view, keyed by route; unknown routes get no icon.
const TAB_ICONS: Record<string, ReactNode> = {
  '/': (
    <svg {...ICON}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 4v2M12 18v2M4 12h2M18 12h2" />
    </svg>
  ),
  '/explorer': (
    <svg {...ICON}>
      <path d="M3 17l5-6 4 3 5-8 4 5" />
      <path d="M3 21h18" />
    </svg>
  ),
  '/accuracy': (
    <svg {...ICON}>
      <path d="M5 21V10M12 21V4M19 21v-7" />
    </svg>
  ),
}

/** Position of the cutoff within the UK day, as a percentage, for the little progress rail. */
function clockShare(cutoff: string): number {
  const [h, m] = cutoff.split(':').map(Number)
  return Math.min(100, Math.max(0, ((h * 60 + m) / 1440) * 100))
}

export function TopBar({
  tabs,
  activePath,
  cutoff,
  theme,
  onToggleTheme,
  onOpenSettings,
  onOpenAbout,
}: {
  tabs: Tab[]
  activePath: string
  cutoff: string
  theme: 'light' | 'dark'
  onToggleTheme: () => void
  onOpenSettings: () => void
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
        <span className="topbar__logo" aria-hidden="true">
          <svg {...ICON} width={26} height={26} strokeWidth={2}>
            <path d="M12 13v8M9 21h6" />
            <g className="topbar__blades">
              <path d="M12 12V3M12 12l-7.8 4.5M12 12l7.8 4.5" />
            </g>
            <circle cx="12" cy="12" r="1.5" fill="currentColor" />
          </svg>
        </span>
        <div className="topbar__text">
          <span className="topbar__title">Wind Forecast Monitor</span>
          <span className="topbar__subtitle">
            GB wind forecast vs actual, decisions in Jan 2026
          </span>
        </div>
      </div>
      <nav className="tabs" aria-label="Views">
        <span className="tabs__label" aria-hidden="true">
          Views
        </span>
        {tabs.map((tab) => (
          <a
            key={tab.path}
            href={tab.path + window.location.search}
            className="tabs__tab"
            aria-current={tab.path === activePath ? 'page' : undefined}
            aria-label={tab.label}
            onClick={follow(tab.path)}
          >
            <span className="tabs__icon">{TAB_ICONS[tab.path]}</span>
            <span className="tabs__text">
              <span className="tabs__name">{tab.label}</span>
              <span className="tabs__hint">{tab.hint}</span>
            </span>
          </a>
        ))}
      </nav>
      <div className="topbar__clock" aria-label="Decision clock">
        <span className="topbar__clock-label">Decision clock</span>
        <span className="topbar__clock-value">{cutoff}</span>
        <span className="topbar__clock-note">UK time, the day before delivery</span>
        <span className="topbar__clock-track" aria-hidden="true">
          <span className="topbar__clock-fill" style={{ width: `${clockShare(cutoff)}%` }} />
        </span>
      </div>
      <div className="topbar__about">
        <button type="button" className="button button--ghost" onClick={onOpenAbout}>
          About this data
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          onClick={onToggleTheme}
        >
          {theme === 'dark' ? (
            <svg {...ICON}>
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
            </svg>
          ) : (
            <svg {...ICON}>
              <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
            </svg>
          )}
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Settings"
          onClick={onOpenSettings}
        >
          <svg {...ICON}>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
          </svg>
        </button>
      </div>
    </header>
  )
}
