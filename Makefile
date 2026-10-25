# Developer entry points. Run from the repo root.
.PHONY: install lock data notebook test lint format up

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

data: ## FR-1.5: download raw Elexon data, then build the processed parquet + quality report
	cd $(BACKEND) && .venv/bin/python -m scripts.fetch_data
	cd $(BACKEND) && .venv/bin/python -m scripts.build_dataset

notebook: ## Re-run every notebook from a clean kernel and save outputs + figures in place
	cd $(BACKEND) && for nb in ../notebooks/*.ipynb; do .venv/bin/python -m scripts.run_notebook $$nb || exit 1; done

test:
	cd $(BACKEND) && .venv/bin/pytest -q

lint:
	cd $(BACKEND) && .venv/bin/ruff check --config pyproject.toml . ../notebooks
	cd $(BACKEND) && .venv/bin/ruff format --check --config pyproject.toml . ../notebooks
	cd $(FRONTEND) && npm run lint && npm run format:check

format:
	cd $(BACKEND) && .venv/bin/ruff check --fix --config pyproject.toml . ../notebooks
	cd $(BACKEND) && .venv/bin/ruff format --config pyproject.toml . ../notebooks
	cd $(FRONTEND) && npm run format

up:
	@echo "make up: not yet implemented (Docker and production deploy ticket). Until then:"
	@echo "  cd backend && .venv/bin/uvicorn app.main:app --reload --port 8000"
	@echo "  cd frontend && npm run dev"
