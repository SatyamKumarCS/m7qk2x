// Footer (FR-3.17): Elexon attribution, app and API versions, GitHub link.

import { APP_VERSION, ELEXON_SOURCES, REPO_URL } from '../constants.ts'

export function Footer({ apiVersion }: { apiVersion: string | null }) {
  return (
    <footer className="footer">
      <p>
        Data: Elexon BMRS{' '}
        {ELEXON_SOURCES.map((s, i) => (
          <span key={s.url}>
            {i > 0 && ' and '}
            <a href={s.url} target="_blank" rel="noreferrer">
              {s.short}
            </a>
          </span>
        ))}
        . Operationally metered wind only. All times UK time.
      </p>
      <p>
        App v{APP_VERSION}
        {apiVersion && ` · API v${apiVersion}`} ·{' '}
        <a href={REPO_URL} target="_blank" rel="noreferrer">
          GitHub
        </a>
      </p>
    </footer>
  )
}
