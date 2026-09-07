# syntax=docker/dockerfile:1.7
# Multi-stage build for the QCaaS API.
#   docker build -f infra/Dockerfile -t qcaas-api .
#   docker run --rm -p 8000:8000 --env-file .env qcaas-api

# ---- builder ---------------------------------------------------------------
FROM python:3.12-slim AS builder

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_PYTHON_DOWNLOADS=never

COPY --from=ghcr.io/astral-sh/uv:0.8 /uv /usr/local/bin/uv

WORKDIR /src
# Dependency layer first so code changes do not invalidate the (large) Qiskit/Aer install.
COPY pyproject.toml uv.lock README.md ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project --extra classiq

COPY qcaas ./qcaas
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --extra classiq

# ---- runtime ---------------------------------------------------------------
FROM python:3.12-slim AS runtime

LABEL org.opencontainers.image.title="qcaas-api" \
      org.opencontainers.image.description="QCaaS MVP API: Qiskit optimisation, quoting and interpretation with IBM + Classiq backends" \
      org.opencontainers.image.source="https://github.com/OWNER/QCaaS"

ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    QCAAS_DATABASE_URL=sqlite:////data/qcaas.db \
    QCAAS_ENVIRONMENT=production \
    QCAAS_DEV_API_KEY= \
    HOME=/home/app \
    CLASSIQ_DIR=/home/app

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --system app && useradd --system --gid app --home-dir /home/app --create-home app \
 && mkdir -p /data && chown app:app /data \
 # pip/setuptools are never used at runtime (the venv is baked in the builder); drop them so
 # their CVEs don't show up in image scans.
 && python -m pip uninstall -y pip setuptools 2>/dev/null || true \
 && rm -rf /usr/local/lib/python3.12/ensurepip

COPY --from=builder --chown=app:app /opt/venv /opt/venv
COPY --from=builder --chown=app:app /src/qcaas /app/qcaas

WORKDIR /app
USER app
VOLUME ["/data"]
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8000/healthz || exit 1

CMD ["uvicorn", "qcaas.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--timeout-keep-alive", "30"]
