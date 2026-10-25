# AGENTS.md

Wind Forecast Monitor: a React + FastAPI web app that shows a GB day-ahead power buyer the wind forecast they had at decision time (09:20 UK on D-1) and how wrong it usually is. Data: Elexon FUELHH (WIND) and WINDFOR, for purchase decisions made in January 2026.

**Status:** scaffold in place (stub API, placeholder UI, tooling); no features yet. The next tickets are on the frontier in [issues/README.md](issues/README.md).

## Where things live (one fact, one place)

| Doc | Holds | Precedence |
|---|---|---|
| [Brief](<REint Full Stack SWE challenge v4.1 Shared - intern.md>) (local only, gitignored per Q-8) | Client requirements and deliverables | 1 (wins every conflict) |
| [PRD](<PRD — Wind Forecast Monitor (UK Day-Ahead Procurement).md>) | What and why: requirements FR/UC/E-n, NFRs, milestones | 2 |
| [ADRs](docs/adr/README.md) | Why a choice was made | 3 |
| [Spec](docs/spec.md) | How: contracts, signatures, constants, traceability | 4 |
| [Issues](issues/README.md) | Units of work, dependency-ordered, with acceptance criteria | 5 |
| [Map](docs/map.md) | Where the effort stands: destination, decisions, fog, scope | index only |
| [Assumptions and open questions](docs/assumptions.md) | Working assumptions, unresolved questions, PRD review notes | – |

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
make install                   # Python 3.11 venv via uv + pinned deps; npm ci
make test                      # pytest (backend)
make lint                      # ruff check + format check; eslint + prettier check
make format                    # apply ruff + prettier fixes
make lock                      # re-pin backend deps from requirements*.in
cd backend && .venv/bin/uvicorn app.main:app --reload --port 8000
cd frontend && npm run dev     # :5173
make data / make up            # stubs until the pipeline / Docker tickets
```

Python deps: edit `backend/requirements*.in`, then run `make lock` (never hand-edit the `.txt` files). Frontend deps install exact versions (`.npmrc` sets `save-exact`).

## Library docs

Use Context7 for library and API documentation (FastAPI, pandas, Recharts, Vite, Vercel, and others) before relying on memory.
