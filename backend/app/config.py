"""Project constants (docs/spec.md §2). Code reads tunables from here, never from literals.

Only the data-window, fetch and dataset-build settings exist so far; the Forecast selection
engine ticket adds the rest of spec §2.
"""

from datetime import date
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
RAW_DIR = DATA_DIR / "raw"
PROCESSED_DIR = DATA_DIR / "processed"

# Fetch windows, half-open [start, end) UTC dates (PRD §4.2, ADR 0005). The buffer days on
# both sides cover the edge delivery days (E-7).
FETCH_ACTUALS: tuple[date, date] = (date(2026, 1, 1), date(2026, 2, 2))  # by settlement date
FETCH_FORECASTS: tuple[date, date] = (date(2025, 12, 29), date(2026, 2, 1))  # by publish time

FETCH_CHUNK_DAYS = 7
TIMEOUT_S = 30
BACKOFF_S: tuple[int, ...] = (2, 4, 8)  # one wait per retry, so len + 1 attempts in total

# Verified resolutions (docs/data_notes.md §2-3); the build warns if the data disagrees.
ACTUAL_RESOLUTION_MIN = 30
FORECAST_RESOLUTION_MIN = 60

# E-13: flag (never drop) values above this. Capacity data is out of scope (assumption A-11).
SPIKE_THRESHOLD_MW = 30_000
