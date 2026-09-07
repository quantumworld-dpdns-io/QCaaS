# QCaaS – Quantum-Computing-as-a-Service MVP

An API (and dashboard) for teams that know Qiskit but do not want to hand-tune circuits, guess QPU
costs, or translate measurement histograms into decisions.

* **`POST /v2/optimize`** – upload a circuit (OpenQASM 2/3, gate-list JSON, or a Classiq Qmod model)
  → transpile/optimise for an IBM backend → simulate (ideal or with the device noise model) →
  estimate QPU seconds and cost → business-language interpretation.
* **`POST /v2/quote`** – price first, run later. Both engines (IBM Composer, Classiq) are estimated,
  with a recommendation and a `valid_until`.
* **`POST /v2/interpret`** – turn counts / IBM job results into success probability, noise
  concerns, recommendations and next steps.
* **`GET /v2/jobs`**, **`GET /v2/jobs/{id}`** – history per API key; payloads optionally encrypted
  with a customer-supplied key.

IBM Composer (Qiskit preset pass manager against the live or fake IBM `Target`) is the primary
engine; Classiq is the redundant second engine. Redundancy modes: `single`, `fallback` (default,
30 s timeout, reason recorded in `selected_result.reason`), `parallel` (both run, cheapest wins).

Three tiers of access:

| Who | Where | How |
|---|---|---|
| Visitor (not logged in) | `web/` welcome + pricing pages | public |
| Customer (logged in) | `web/` customer dashboard: provision an API key, quote / optimise / interpret through the authenticated proxy, job history | account in the **accounts service** (Go, `accounts/`), JWT |
| Admin (logged in, role `admin`) | `web/` admin dashboard: users, roles, cross-customer jobs, revenue/QPU stats, audit log | same, role `admin` (first sign-up or `ACCOUNTS_ADMIN_EMAILS`) |
| Machine client | `qcaas/` API directly | `X-API-Key` |

## Repository layout

```
accounts/         Go accounts service: register/login, roles, API-key provisioning,
                  authenticated reverse proxy (/proxy/v2/*), admin endpoints (see accounts/README.md)
qcaas/            FastAPI app
  api/            routers: optimize, quote, interpret, jobs, health
  core/           circuits (loaders), backends (ibm, classiq, router), metrics, simulate,
                  cost (estimator, pricing, table), interpret (rules, report)
  services/       one orchestrator per endpoint + persistence + QPU submission (Phase 8)
  auth/           API-key auth, per-customer rate limiting
  storage/        SQLAlchemy models, SQLite/Postgres engine, retention purge, payload crypto
  schemas/        Pydantic request/response models = the OpenAPI source of truth
  pricing.yaml    every business number (IBM $/min per plan, fees, Classiq amortisation)
  cli.py          `qcaas create-key | export-openapi | export-pricing | purge-expired | warm`
tests/            unit + API tests (offline; IBM fake backends, Classiq stubbed)
docs/             openapi.json, pricing.csv (both generated), interpretation report template
infra/            Dockerfile, docker-compose.yml, fly.toml, smoke.sh
web/              Next.js dashboard (Vercel)
.github/          CI, image build + Trivy scan, Fly deploy, Dependabot
```

## Quickstart (API)

```bash
uv sync --extra classiq            # Python 3.11–3.13
cp .env.example .env               # defaults: offline mode, dev key "dev-key-change-me"
uv run uvicorn qcaas.main:app --reload
# Swagger UI: http://localhost:8000/docs
```

Offline mode (`QCAAS_OFFLINE_MODE=true`, the default) uses `qiskit_ibm_runtime` fake backends
(`ibm_sherbrooke`, `ibm_brisbane`, `ibm_torino`, `ibm_fez`, …), so no IBM account is needed to
develop or run the tests. The first request to a backend takes a few seconds while its 127-qubit
target loads; the server warms the default backend at startup.

```bash
export KEY=dev-key-change-me
BELL='OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[2];\ncreg c[2];\nh q[0];\ncx q[0],q[1];\nmeasure q -> c;\n'

# Quote
curl -s localhost:8000/v2/quote -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \
  -d "{\"circuit_format\":\"openqasm2\",\"circuit_payload\":\"$BELL\",\"shots\":4096,\"budget_mode\":\"payg\"}"

# Optimise + noisy simulation + interpretation
curl -s localhost:8000/v2/optimize -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \
  -d "{\"circuit_format\":\"openqasm2\",\"circuit_payload\":\"$BELL\",\"target_backend\":\"ibm_sherbrooke\",
       \"optimization_level\":2,\"noisy_simulation\":true,\"target_bitstrings\":[\"00\",\"11\"],
       \"redundancy_mode\":{\"mode\":\"fallback\",\"primary\":\"ibm_composer\"}}"

# Interpret an existing result
curl -s localhost:8000/v2/interpret -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \
  -d '{"result_format":"counts_dict","result_payload":{"00":480,"11":496,"01":24,"10":24},
       "target_bitstrings":["00","11"],"context":{"algorithm":"QAOA","problem_description":"portfolio, 10 assets"}}'
```

Create a real customer key: `uv run qcaas create-key --name "Acme" --plan flex --retention-days 30`.

### Headers

| Header | Purpose |
|---|---|
| `X-API-Key` | required on every `/v2/*` call |
| `X-Payload-Key` | optional; encrypts the stored request/response with a key derived from this secret (never stored). The same header is needed to read them back from `/v2/jobs/{id}`. |
| `X-RateLimit-Limit`, `X-RateLimit-Remaining` | returned on every authenticated response |

## Configuration

All settings are environment variables prefixed `QCAAS_` (see `.env.example`). The important ones:

| Variable | Default | Meaning |
|---|---|---|
| `QCAAS_OFFLINE_MODE` | `true` | fake IBM backends instead of the live service |
| `QCAAS_IBM_TOKEN`, `QCAAS_IBM_INSTANCE` | – | IBM Quantum Platform credentials (live targets, quotes on real calibration data) |
| `QCAAS_ALLOW_QPU_EXECUTION` | `false` | master switch for `execute_on_qpu` (costs real money) |
| `CLASSIQ_CLIENT_ID`, `CLASSIQ_CLIENT_SECRET` | – | Classiq machine-to-machine credentials (read by the Classiq SDK) |
| `QCAAS_API_KEY_SALT` | change it | HMAC salt for stored API-key hashes and payload encryption KDF |
| `QCAAS_DEV_API_KEY` | `dev-key-change-me` | dev/staging convenience customer; unset in production |
| `QCAAS_CORS_ORIGINS` | `["http://localhost:3000"]` | dashboard origins (`*.vercel.app` previews are allowed outside production) |
| `QCAAS_DATABASE_URL` | `sqlite:///./data/qcaas.db` | SQLAlchemy URL; use Postgres before any SLA |
| `QCAAS_FALLBACK_TIMEOUT_SEC` | `30` | primary-engine timeout in `fallback` mode |

Business numbers live in `qcaas/pricing.yaml`: IBM QPU price per minute per plan (PAYG 96 / Flex 72
/ Premium 48 USD, **re-validate against IBM's current price list before quoting**), service cost
components and target margin, Classiq annual contract amortisation, and the QPU-time estimation
constants. `docs/pricing.csv` is generated from it (`uv run qcaas export-pricing`) and CI fails if
it drifts.

## How estimates and billing work

* **QPU seconds** = `shots × (critical-path circuit duration on the target + repetition delay) +
  job overhead`. Gate and measurement durations come from the backend `Target`; defaults from
  `pricing.yaml` fill any gaps. When a real Runtime job exists, `job.usage_estimation` and the
  actual usage override the estimate (`billing.actual_qpu_cost_usd`).
* **Billing block** (external): `qpu_cost_usd` (pass-through at plan rate) + `service_fee_usd`
  (service cost ÷ (1 − margin), min fee) + `classiq_platform_fee_usd` (itemised when Classiq ran;
  set `classiq.visible_to_customer: false` to fold it into the service fee) = `total_usd`.
  The internal breakdown (cost vs price, margin) is stored per job for calibration.
* **Both engines' results are always stored** (`backend_results` table) even when only
  `selected_result` is returned, so the "how much does Classiq really save" ratio can be calibrated
  from production data.

## Classiq integration – what is and is not possible

Verified against `classiq` 1.28:

| Input | Classiq path | Notes |
|---|---|---|
| `qmod` (serialised model JSON from `classiq.create_model()`) | `synthesize()` with `Constraints(max_depth/max_width/max_gate_count)` | full high-level synthesis; IBM numbers come from re-transpiling the synthesised circuit for the target |
| `openqasm2/3`, `json` | `quantum_program_from_qasm()` | Classiq's server-side transpiler; a transpilation pass, not a re-synthesis |
| native `.qmod` text, Python Qmod | not accepted | the SDK has no native-Qmod parser (`qasm_to_qmod` only emits text) and Python Qmod would mean executing customer code |

Without Classiq credentials the engine reports `not_applicable` and the router falls back to IBM;
`/v2/quote` then shows an `assumed` Classiq estimate (configurable saving, default 15 %).

`circuit_format: qiskit_python` is **rejected with HTTP 422** and guidance to export QASM; running
customer Python needs a sandbox and is a follow-up.

## Development

```bash
uv run ruff check qcaas tests && uv run ruff format --check qcaas tests
uv run pytest -q                       # ~1 min; first fake-backend load dominates
uv run qcaas export-openapi --check    # CI fails on OpenAPI drift
```

## Accounts service and the internal API

`accounts/` (Go) owns end-user identity so the browser never has to hold a raw QCaaS key:
sign-up/login (bcrypt + HS256 JWT), roles `customer`/`admin`, API-key provisioning, an
authenticated reverse proxy (`/proxy/v2/*` → `/v2/*` with the user's key injected), and admin
views (users, cross-customer jobs, stats, audit log). It provisions customers through the API's
`/internal/*` endpoints, which are guarded by the shared `QCAAS_ADMIN_TOKEN` header and are hidden
from the public OpenAPI document (404 when the token is unset). Details: `accounts/README.md`.

## Containers, CI/CD, deployment

```bash
docker build -f infra/Dockerfile -t qcaas-api .                 # Python API (~300 MB)
docker build -f infra/Dockerfile.accounts -t qcaas-accounts .   # Go accounts service (distroless)
docker build -f infra/Dockerfile.web -t qcaas-web web           # Next.js standalone (compose/on-prem)
docker compose -f infra/docker-compose.yml up --build           # api :8000, accounts :8080, web :3000
```

* `.github/workflows/ci.yml` – ruff, pytest (3.11/3.12), OpenAPI + pricing drift checks, and the
  web app's lint/typecheck/test/build. No cloud credentials are used in CI.
* `.github/workflows/docker.yml` – builds `ghcr.io/<owner>/qcaas-api` on `main` and `v*` tags,
  Trivy scan (HIGH/CRITICAL fail), GHA layer cache.
* `.github/workflows/deploy-api.yml` – Fly.io deploy: staging automatically after a successful
  image build, production via `workflow_dispatch` behind the protected `production` environment;
  both run `infra/smoke.sh` (health + a real quote) afterwards. Secrets: `FLY_API_TOKEN_*`,
  `*_SMOKE_API_KEY`.
* `infra/fly.toml` – one machine (SQLite on a volume) in Tokyo; Azure Container Apps is the
  documented alternative (only the deploy workflow changes).
* Frontend deploys are handled by Vercel's Git integration from `web/` (see `web/README.md`).

## Limitations and roadmap

1. SQLite on one volume is fine for the MVP; move to managed Postgres before signing an SLA.
2. `/v2/optimize` is synchronous. Real QPU submissions (`execute_on_qpu`) return immediately with
   the IBM job id; `GET /v2/jobs/{id}` refreshes status and actual usage. A Redis/RQ queue is the
   planned next step once jobs run for minutes.
3. Interpretation is rule-based (thresholds on readout/CX error, coherence, distribution shape);
   an LLM narrative layer and the paid "engineer deep-interpretation" report
   (`docs/interpretation_report_template.md`) sit on top of it.
4. The dashboard keeps the customer's API key in `sessionStorage`; replace with accounts and
   short-lived tokens before marketing it publicly.
