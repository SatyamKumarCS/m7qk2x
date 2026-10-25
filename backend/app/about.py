"""User-facing text served by /api/meta (the frontend's "About this data" panel).

These restate decisions already recorded in the ADRs (docs/adr); keep them in plain English.
"""

from app.metrics import BIAS_NOTE, DATA_SCOPE_NOTE

ASSUMPTIONS: list[str] = [
    "Purchase decisions are made in January 2026, so delivery days run from 2 January to "
    "1 February 2026 (UK calendar days; UK time equals UTC in this period).",
    "The forecast for each hour is the newest WINDFOR value published at or before the cutoff, "
    "in UK time, on the day before delivery. Later forecasts are never used; if none exists, "
    "the hour is left empty.",
    "The default cutoff is 09:20 UK time (EPEX GB day-ahead auction close). 09:50 (N2EX) and "
    "06:00 are presets, and any HH:MM can be chosen.",
    "Forecasts are hourly. Each is compared with the half-hourly actual that starts at the same "
    "time; exactly which instant a WINDFOR value represents is not documented by Elexon.",
    DATA_SCOPE_NOTE,
    "Error means forecast minus actual, so a positive error means the forecast was too high.",
    "The planning band is built from January's own forecast errors at the chosen cutoff. Its "
    "coverage is reported both in-sample and on held-out days; it is observed, not guaranteed.",
    BIAS_NOTE,
]

SOURCES: list[dict[str, str]] = [
    {
        "name": "Elexon BMRS – FUELHH (actual generation by fuel type)",
        "url": "https://bmrs.elexon.co.uk/api-documentation/endpoint/datasets/FUELHH/stream",
    },
    {
        "name": "Elexon BMRS – WINDFOR (wind generation forecast)",
        "url": "https://bmrs.elexon.co.uk/api-documentation/endpoint/datasets/WINDFOR/stream",
    },
]
