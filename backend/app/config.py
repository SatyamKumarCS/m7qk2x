"""Project constants (docs/spec.md §2). Code reads tunables from here, never from literals."""

import os
from datetime import date
from pathlib import Path

TZ = "Europe/London"  # delivery days and cutoffs are UK wall-clock (ADR 0005)

# Delivery days in scope, inclusive: decision days D-1 = 1-31 Jan 2026 (ADR 0005).
DELIVERY_START = date(2026, 1, 2)
DELIVERY_END = date(2026, 2, 1)

# Day-ahead cutoff clock, UK time, "HH:MM" (ADR 0002, UC-6).
DEFAULT_CUTOFF = "09:20"
CUTOFF_PRESETS: dict[str, str] = {"EPEX GB": "09:20", "N2EX": "09:50", "Early": "06:00"}

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

# Analysis settings (PRD §5.4-5.6). Horizon bucket edges, half-open [a, b) hours (ADR 0008).
HORIZON_BINS_H: tuple[float, ...] = (0, 6, 12, 24, 36, 48, 72)
WIND_LEVEL_BINS_MW: tuple[float, ...] = (float("-inf"), 5000, 10000, 15000, float("inf"))
LOW_SAMPLE_N = 30
MAPE_MIN_ACTUAL_MW = 1000
BAND_QUANTILES: dict[int, tuple[float, float]] = {80: (0.10, 0.90), 90: (0.05, 0.95)}

# API (FR-2.10, FR-2.11).
CACHE_SIZE = 256
CORS_ORIGINS: list[str] = os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(",")
