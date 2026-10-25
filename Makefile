# Developer entry points. Run from the repo root.
.PHONY: install lock data test lint format up

BACKEND := backend
FRONTEND := frontend
VENV := $(BACKEND)/.venv

install: ## Python 3.11 venv (via uv) + pinned backend deps, then frontend deps from the lockfile
	uv venv --python 3.11 $(VENV)
	uv pip install --python $(VENV)/bin/python -r $(BACKEND)/requirements-dev.txt
	cd $(FRONTEND) && npm ci

lock: ## Re-pin every backend dependency (direct + transitive) from requirements*.in
	cd $(BACKEND) && uv pip compile requirements.in --universal --python-version 3.11 -o requirements.txt -q
	cd $(BACKEND) && uv pip compile requirements-dev.in --universal --python-version 3.11 -o requirements-dev.txt -q

data:
	@echo "make data: not yet implemented (Fetch raw Elexon data + Build processed dataset tickets)"

test:
	cd $(BACKEND) && .venv/bin/pytest -q

lint:
	cd $(BACKEND) && .venv/bin/ruff check . && .venv/bin/ruff format --check .
	cd $(FRONTEND) && npm run lint && npm run format:check

format:
	cd $(BACKEND) && .venv/bin/ruff check --fix . && .venv/bin/ruff format .
	cd $(FRONTEND) && npm run format

up:
	@echo "make up: not yet implemented (Docker and production deploy ticket). Until then:"
	@echo "  cd backend && .venv/bin/uvicorn app.main:app --reload --port 8000"
	@echo "  cd frontend && npm run dev"
