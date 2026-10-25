"""Project constants (docs/spec.md §2). Code reads tunables from here, never from literals.

Only the data-window and fetch settings exist so far; the Forecast selection engine ticket
adds the rest of spec §2.
"""

from datetime import date
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
RAW_DIR = DATA_DIR / "raw"

# Fetch windows, half-open [start, end) UTC dates (PRD §4.2, ADR 0005). The buffer days on
# both sides cover the edge delivery days (E-7).
FETCH_ACTUALS: tuple[date, date] = (date(2026, 1, 1), date(2026, 2, 2))  # by settlement date
FETCH_FORECASTS: tuple[date, date] = (date(2025, 12, 29), date(2026, 2, 1))  # by publish time

FETCH_CHUNK_DAYS = 7
TIMEOUT_S = 30
BACKOFF_S: tuple[int, ...] = (2, 4, 8)  # one wait per retry, so len + 1 attempts in total
