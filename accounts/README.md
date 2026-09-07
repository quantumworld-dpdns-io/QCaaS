# QCaaS accounts service (Go)

Sign-up / login, roles, API-key provisioning and an authenticated reverse proxy in front of the
Python QCaaS API. The browser talks to this service with a JWT; the QCaaS API key never leaves
the server unless the customer explicitly reveals it.

```
browser ──JWT──▶ accounts (Go, :8080) ──X-API-Key──▶ qcaas api (Python, :8000)
                     │  /internal/* with X-Admin-Token (provision customers, admin stats)
                     └─ SQLite: users, encrypted API keys, audit log
```

## Endpoints

| Method / path | Auth | Purpose |
|---|---|---|
| `GET /healthz` | – | liveness + upstream reachability |
| `POST /auth/register` `{email,password,name}` | – | create account. First account becomes **admin** (or any email in `ACCOUNTS_ADMIN_EMAILS`). Returns `{token, expires_at, user}` |
| `POST /auth/login` `{email,password}` | – | returns `{token, expires_at, user}` |
| `GET /me` | bearer | profile, role, `has_api_key`, key prefix |
| `PATCH /me` `{name}` | bearer | update display name |
| `POST /me/api-key` `{plan?, retention_days?}` | bearer | provision a QCaaS customer + key via `/internal/customers` (idempotent); returns the key once created |
| `GET /me/api-key` | bearer | reveal the stored key (audited) |
| `ANY /proxy/v2/*` | bearer | reverse proxy to the QCaaS API with the caller's key injected (`/proxy/v2/quote` → `/v2/quote`). `X-Payload-Key` passes through. 409 if no key yet |
| `GET /admin/users` | admin | list accounts |
| `PATCH /admin/users/{id}` `{role?, active?, name?}` | admin | change role / disable (mirrored to the QCaaS customer); self-lockout guarded |
| `GET /admin/stats` | admin | account counts + QCaaS `/internal/stats` (jobs, revenue, QPU seconds) |
| `GET /admin/jobs?limit=&offset=&kind=&customer_id=` | admin | all jobs across customers, enriched with account emails |
| `GET /admin/audit` | admin | last 200 audit entries |

Errors are `{error, code}`; tokens are HS256 JWTs (`Authorization: Bearer …`), 24 h by default.

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `ACCOUNTS_ADDR` | `:8080` | |
| `ACCOUNTS_ENVIRONMENT` | `dev` | `production` makes the two secrets below mandatory |
| `ACCOUNTS_DB_PATH` | `./data/accounts.db` | SQLite file path (pure-Go driver) **or** a PostgreSQL URL `postgres://…?sslmode=require` (Neon); dialect is detected from the value |
| `ACCOUNTS_JWT_SECRET` | dev value | **set in production** |
| `ACCOUNTS_ENCRYPTION_KEY` | derived from JWT secret in dev | base64 of 32 random bytes; AES-256-GCM for stored API keys. `openssl rand -base64 32` |
| `ACCOUNTS_JWT_TTL_HOURS` | `24` | |
| `ACCOUNTS_ADMIN_EMAILS` | – | comma-separated admins; if empty the first sign-up is admin |
| `ACCOUNTS_CORS_ORIGINS` | `http://localhost:3000` | comma-separated; `*.vercel.app` also allowed outside production |
| `QCAAS_API_URL` | `http://localhost:8000` | |
| `QCAAS_ADMIN_TOKEN` | – | must equal the API's `QCAAS_ADMIN_TOKEN` |

## Run

```bash
cd accounts
go test ./...
QCAAS_ADMIN_TOKEN=dev-admin-token-change-me go run .          # API must run with the same token
```

Container: `docker build -f infra/Dockerfile.accounts -t qcaas-accounts .` (distroless static
binary, `accounts healthcheck` subcommand serves as the HEALTHCHECK). Whole stack:
`docker compose -f infra/docker-compose.yml up --build`.
