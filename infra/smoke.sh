#!/usr/bin/env bash
# Post-deploy smoke test: health + a real quote with a Bell circuit.
#   QCAAS_SMOKE_API_KEY=... bash infra/smoke.sh https://qcaas-api-staging.fly.dev
set -euo pipefail

BASE="${1:?usage: smoke.sh <base-url>}"
KEY="${QCAAS_SMOKE_API_KEY:?QCAAS_SMOKE_API_KEY is required}"

echo "-> GET $BASE/healthz"
curl -fsS --retry 10 --retry-delay 6 --retry-all-errors "$BASE/healthz" | tee /tmp/health.json
grep -q '"status":"ok"' /tmp/health.json

echo "-> POST $BASE/v2/quote"
BODY='{"circuit_format":"openqasm2","circuit_payload":"OPENQASM 2.0;\ninclude \"qelib1.inc\";\nqreg q[2];\ncreg c[2];\nh q[0];\ncx q[0],q[1];\nmeasure q -> c;\n","shots":1024}'
curl -fsS -X POST "$BASE/v2/quote" -H "Content-Type: application/json" -H "X-API-Key: $KEY" -d "$BODY" | tee /tmp/quote.json
grep -q '"recommended_backend"' /tmp/quote.json
echo
echo "smoke OK"
