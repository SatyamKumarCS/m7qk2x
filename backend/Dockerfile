# FastAPI backend for local runs (PRD §12.1, Issue 016). Production runs on Vercel (ADR 0007).
# Runtime deps come from the pinned requirements.txt via uv; only app/ and the committed processed
# data are copied in. Nothing is written at runtime (E-26), so the container can run read-only.

FROM ghcr.io/astral-sh/uv:0.11.7 AS uv

FROM python:3.12.15-slim-trixie

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_NO_CACHE=1 \
    PORT=8000

WORKDIR /srv

COPY requirements.txt .
RUN --mount=from=uv,source=/uv,target=/bin/uv \
    uv pip install --system --compile-bytecode -r requirements.txt

COPY app/ app/
COPY data/processed/ data/processed/

RUN useradd --system --uid 10001 --no-create-home api
USER api

EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
    CMD ["python", "-c", "import os, urllib.request; urllib.request.urlopen(f\"http://127.0.0.1:{os.environ['PORT']}/api/health\", timeout=2)"]

CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port \"$PORT\""]
