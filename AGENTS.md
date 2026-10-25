# AGENTS.md

Wind Forecast Monitor: a React + FastAPI web app that shows a GB day-ahead power buyer the wind forecast they had at decision time (09:20 UK on D-1) and how wrong it usually is. Data: Elexon FUELHH (WIND) and WINDFOR, for purchase decisions made in January 2026.

**Status:** these are implemented:

- the offline data pipeline;
- the selection, metrics and band engines;
- the read-only API;
- all three views: Decision, Forecast vs actual (Explorer) and Accuracy report.

Docker, production deployment (Vercel chosen, but the owner deploys), and the submission README and video are still to do. The next tickets are on the frontier in [issues/README.md](issues/README.md).

## Architecture at a glance

Details are in [spec](docs/spec.md) §1, §5 and §6.

- **Offline data** (`backend/scripts/`, run by `make data`): `fetch_data.py` downloads raw Elexon JSON, which is gitignored. `build_dataset.py` writes the processed parquet and `quality_report.json`, both committed. Nothing calls Elexon at runtime.
- **Core logic** (`backend/app/`, pure pandas functions):
  - `selection.py` picks the decision-time forecast;
  - `metrics.py` computes errors, metrics, breakdowns and day summaries;
  - `band.py` builds the empirical planning band.

  The constants live in `config.py`.
- **API** (`backend/app/`): `main.py` (FastAPI app, CORS, logging) → `routes.py` (six GET endpoints, query validation, 422s) → `service.py` (cached responses built only from the core modules, plus the publish-time invariant). Supporting modules:
  - `data_store.py` loads the parquet once;
  - `schemas.py` holds exact-key Pydantic models;
  - `about.py` holds the assumptions and sources text.
- **Frontend** (`frontend/src/`, React 19 + Vite + Recharts):
  - `App.tsx` is the shell: tabs, a History-API router, URL-driven filters (`hooks/useFilters.ts`) and the server status.
  - `api/` holds the typed client, with `types.ts` mirroring spec §5.
  - `pages/` holds one page per view.
  - `components/` holds the charts and shared UI.
  - `utils/` holds pure, tested logic: time, formatting, and per-view helpers.
  - `test/` holds the API fixtures.

## Where things live (one fact, one place)

| Doc | Holds | Precedence |
|---|---|---|
| Brief (kept outside the repo by the owner) | Client requirements and deliverables | 1 (wins every conflict) |
| PRD (kept outside the repo by the owner) | What and why: requirements FR/UC/E-n, NFRs, milestones | 2 |
| [ADRs](docs/adr/README.md) | Why a choice was made | 3 |
| [Spec](docs/spec.md) | How: contracts, signatures, constants, traceability | 4 |
| [Issues](issues/README.md) | Units of work, dependency-ordered, with acceptance criteria | 5 |
| [Map](docs/map.md) | Where the effort stands: destination, decisions, fog, scope | index only |
| [Assumptions and open questions](docs/assumptions.md) | Working assumptions, unresolved questions, PRD review notes | – |

The brief and the PRD were removed from the repo by the owner on 2026-10-25. Cite them by section and ID (PRD §5.6, FR-3.4, E-11); don't recreate or re-add them. If you need wording from them, ask the owner.

Cite a doc instead of copying it. If two docs disagree, the higher one wins. Fix the lower one, or open a question in `docs/assumptions.md`.

## Working an issue

1. Pick from the **frontier** in [issues/README.md](issues/README.md): open, every `blocked_by` closed, `assignee` empty. If you weren't told which ticket, take the lowest-numbered one.
2. **Claim it first**: set `assignee` and `status: in-progress` in its frontmatter and in the index row.
3. Work **one ticket per session**. Stay inside its Scope. Anything new you find becomes a new ticket or an open question.
4. Done means every acceptance-criterion box is ticked and checkable (test, command output, or link).
5. Close it: add `## Resolution` (what was done or decided, key facts, links), set `status: closed`, update the index, and add a one-line gist under *Decisions so far* in [docs/map.md](docs/map.md) when it decided something.
6. A decision that changes the architecture or a rule gets a new ADR or a status change on an existing one. Never rewrite an accepted ADR silently.

Decision tickets (`wayfinder:research|grilling|task`) follow the [Wayfinder](docs/map.md#notes) rules: **grilling** tickets are HITL, so the agent asks and the human answers. Never answer your own questions.

## Hard rules

- Never use a forecast with `publishTime` after `cutoff(t)` ([ADR 0002](docs/adr/0002-forecast-selection-rule.md)). Tests and a runtime assertion enforce this.
- No Elexon calls at runtime. Only the offline scripts fetch data ([ADR 0001](docs/adr/0001-offline-pipeline-committed-data.md)).
- Store UTC. Display Europe/London with a "UK time" label. Handle dates as `YYYY-MM-DD` strings ([ADR 0005](docs/adr/0005-time-handling-and-scope.md)).
- Do not edit the brief or the PRD. They are source documents. Record corrections in `docs/assumptions.md`.
- Budget: 16 h total. Track hours per ticket. If you're behind, follow the PRD §13 cut list. Never cut the cutoff rule, its tests, the accuracy screen, Docker, or the video.
- Keep files under about 300 lines. Python is typed and passes `ruff`. The frontend is TypeScript and passes ESLint and Prettier. Pin every dependency.
- No secrets, no write endpoints. Validate every query param (HTTP 422 on bad input).
- The README must declare which AI tools were used (brief requirement).

## Commands

```sh
make install                   # fresh Python 3.12 venv via uv (replaces .venv) + pinned deps; npm ci
make test                      # pytest (backend) + Vitest (frontend, TZ=Asia/Kolkata)
make lint                      # ruff check + format check; eslint + prettier check
make format                    # apply ruff + prettier fixes
make lock                      # re-pin backend deps from requirements*.in
cd backend && .venv/bin/uvicorn app.main:app --reload --port 8000
cd frontend && npm run dev     # :5173
make data                      # fetch raw (gitignored) + build processed parquet/report (committed)
make notebook                  # re-run notebooks/01_exploration.ipynb from a fresh kernel (outputs + docs/figures)
make up                        # stub until the Docker ticket
```

Python deps: edit `backend/requirements*.in`, then run `make lock` (never hand-edit the `.txt` files). Python is **3.12** (Q-15: Vercel has no 3.11; this departs from PRD §10). Ruff and pytest settings live in `backend/ruff.toml` and `backend/pytest.ini`. **Never add a `backend/pyproject.toml`**: Vercel would install from it and ignore `requirements.txt`. Deployment config: `backend/vercel.json` + `.vercelignore` (bundle excludes tests, scripts, raw data) and `frontend/vercel.json` (SPA rewrite); see [ADR 0007](docs/adr/0007-hosting.md). Frontend deps install exact versions (`.npmrc` sets `save-exact`).

## Library docs

Use Context7 for library and API documentation (FastAPI, pandas, Recharts, Vite, Vercel, and others) before relying on memory.
