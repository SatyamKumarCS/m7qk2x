# Developer entry points. Run from the repo root.
.PHONY: install lock data notebook test lint format up

BACKEND := backend
FRONTEND := frontend
# Vercel's Python runtime starts at 3.12 (Q-15, ADR 0007); keep in step with backend/.python-version.
PYTHON_VERSION := 3.12
# Override to use another venv, e.g. `make test VENV=/path/to/venv`.
VENV := $(BACKEND)/.venv
BIN := $(abspath $(VENV))/bin

install: ## Fresh Python 3.12 venv (via uv; replaces an existing one) + pinned backend deps, then frontend deps
	uv venv --clear --python $(PYTHON_VERSION) $(VENV)
	uv pip install --python $(BIN)/python -r $(BACKEND)/requirements-dev.txt
	cd $(FRONTEND) && npm ci

lock: ## Re-pin every backend dependency (direct + transitive) from requirements*.in
	cd $(BACKEND) && uv pip compile requirements.in --universal --python-version $(PYTHON_VERSION) -o requirements.txt -q
	cd $(BACKEND) && uv pip compile requirements-dev.in --universal --python-version $(PYTHON_VERSION) -o requirements-dev.txt -q

data: ## FR-1.5: download raw Elexon data, then build the processed parquet + quality report
	cd $(BACKEND) && $(BIN)/python -m scripts.fetch_data
	cd $(BACKEND) && $(BIN)/python -m scripts.build_dataset

notebook: ## Re-run every notebook from a clean kernel and save outputs + figures in place
	cd $(BACKEND) && for nb in ../notebooks/*.ipynb; do $(BIN)/python -m scripts.run_notebook $$nb || exit 1; done

test: ## Backend pytest, then frontend Vitest (run in Asia/Kolkata to catch date shifts)
	cd $(BACKEND) && $(BIN)/pytest -q
	cd $(FRONTEND) && npm test

lint:
	cd $(BACKEND) && $(BIN)/ruff check --config ruff.toml . ../notebooks
	cd $(BACKEND) && $(BIN)/ruff format --check --config ruff.toml . ../notebooks
	cd $(FRONTEND) && npm run lint && npm run format:check

format:
	cd $(BACKEND) && $(BIN)/ruff format --config ruff.toml . ../notebooks
	cd $(BACKEND) && $(BIN)/ruff check --fix --config ruff.toml . ../notebooks
	cd $(FRONTEND) && npm run format

up:
	@echo "make up: not yet implemented (Docker and production deploy ticket). Until then:"
	@echo "  cd backend && .venv/bin/uvicorn app.main:app --reload --port 8000"
	@echo "  cd frontend && npm run dev"
