# QCaaS Web

Next.js (App Router, TypeScript, Tailwind) frontend for the QCaaS FastAPI backend and the Go **accounts** service.

## Access tiers

| Tier         | Who                              | What they see                                                                                                                                    |
| ------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Visitor**  | not logged in                    | Public welcome page `/` (modules, how it works, pricing), `/login`, `/register`, and direct API-key mode via `/settings`.                          |
| **Customer** | `role: customer`                 | `/dashboard`: profile (editable name), API-key card (provision with plan, reveal/copy), last 5 jobs + spend, quick actions. Quote/Optimize/Interpret/Jobs pages work through the authenticated proxy. |
| **Admin**    | `role: admin` (first registered account) | Everything above plus `/admin`: stats tiles, users table (toggle role / enable-disable with inline confirm, own row locked), jobs across all customers with kind filter + pagination, audit log. Customers get a friendly 403 there. |

Route guards are client-side (`src/components/RequireAuth.tsx`): anonymous users are redirected to `/login?next=…`; the header shows the user email + **Log out** when signed in, otherwise **Log in / Register**. `/dashboard` appears in the nav for any signed-in user, `/admin` only for admins.

### Direct vs session mode

`src/lib/api/client.ts` authenticates `/v2/*` calls in one of two modes, chosen automatically per request (`getClientMode()`):

- **Direct mode** — the pasted API key from `/settings` (kept in `sessionStorage`) is sent as `X-API-Key` straight to `NEXT_PUBLIC_API_BASE_URL`. This is the machine-user path and keeps working with no account.
- **Session mode** — when the user is logged in **and** has provisioned an API key, calls are routed to `${NEXT_PUBLIC_ACCOUNTS_URL}/proxy/v2/*` with `Authorization: Bearer <jwt>`; the accounts service injects the key server-side, so the browser never stores it (unless the user reveals it on the dashboard). Session mode takes precedence over a pasted key. `X-Payload-Key` passes through in both modes; `/healthz` is never proxied.

A 401 from the accounts service or the proxy clears the stored session (`localStorage` key `qcaas.session`) — auto-logout. Auth state lives in `src/lib/auth/` (`store.ts`, `accountsFetch`/`accounts` client, `useAuth()` hook).

## Local development

1. Start the backend on `http://localhost:8000` (from the repo root, e.g. `uvicorn qcaas.main:app --reload`) and the accounts service on `http://localhost:8080` (or `docker compose -f infra/docker-compose.yml up`). Both must allow CORS from `http://localhost:3000`.
2. In `web/`:

   ```bash
   npm ci
   cp .env.example .env.local   # NEXT_PUBLIC_API_BASE_URL / NEXT_PUBLIC_ACCOUNTS_URL
   npm run dev                  # http://localhost:3000
   ```

3. Register at `/register` (the first account becomes admin), provision an API key on `/dashboard`, then use Quote / Optimize / Interpret / Jobs. Alternatively, for direct mode, open **Settings**, paste an API key (sent as `X-API-Key`) and optionally a payload key (`X-Payload-Key`); "Save & test" calls `GET /healthz` and `GET /v2/jobs?limit=1`.

The header **API Docs** link opens `${NEXT_PUBLIC_API_BASE_URL}/docs` (Swagger UI).

### Scripts

| Script              | Purpose                                                        |
| ------------------- | -------------------------------------------------------------- |
| `npm run dev`       | Dev server                                                     |
| `npm run build`     | Production build (`output: "standalone"`)                      |
| `npm start`         | Serve the production build                                     |
| `npm run lint`      | ESLint                                                         |
| `npm run typecheck` | `tsc --noEmit` (covers `src/__tests__` too, same as `next build`) |
| `npm test -- --run` | Vitest (jsdom + Testing Library)                               |
| `npm run gen:api`   | Regenerate `src/lib/api/schema.d.ts` from `../docs/openapi.json` |

## Environment variables

| Variable                   | Description                                                                              |
| -------------------------- | ---------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_API_BASE_URL` | QCaaS backend base URL, no trailing slash. Default `http://localhost:8000`.               |
| `NEXT_PUBLIC_ACCOUNTS_URL` | Accounts service base URL (auth, `/me`, `/admin/*`, `/proxy/v2/*`). Default `http://localhost:8080`. |

Both are inlined at build time (`NEXT_PUBLIC_*`), so each Vercel environment needs its own values:

| Vercel environment | `NEXT_PUBLIC_API_BASE_URL` | `NEXT_PUBLIC_ACCOUNTS_URL`   |
| ------------------ | -------------------------- | ---------------------------- |
| Development        | `http://localhost:8000`    | `http://localhost:8080`      |
| Preview            | staging API URL            | staging accounts URL         |
| Production         | production API URL         | production accounts URL      |

## Deploying on Vercel

- Connect the Git repository and set the project **Root Directory** to `web/`. Vercel's Git integration builds and deploys from that directory (`vercel.json` pins `framework: nextjs`).
- Add both `NEXT_PUBLIC_*` variables per environment as above; redeploy after changing them.
- Make sure the backend's and the accounts service's CORS allow-lists include the Vercel preview and production origins.

## Docker image

`next.config.ts` sets `output: "standalone"`; `infra/Dockerfile.web` copies `.next/standalone`, `.next/static` and `public/`. Build from the repo root with the `web/` directory as context:

```bash
docker build -f infra/Dockerfile.web \
  --build-arg NEXT_PUBLIC_API_BASE_URL=https://api.example.com \
  --build-arg NEXT_PUBLIC_ACCOUNTS_URL=https://accounts.example.com \
  web
```

## Regenerating API types

Whenever the backend contract changes, re-export `docs/openapi.json` from FastAPI, then:

```bash
npm run gen:api
npm run typecheck
```

`src/lib/api/schema.d.ts` is committed; `src/lib/api/types.ts` re-exports the schemas used by the UI, and `src/lib/api/client.ts` is the typed fetch wrapper (adds auth headers per mode, surfaces backend `{error, detail, code}` as `ApiError`, and exposes `X-RateLimit-*`).

## i18n

Locale is `zh-TW` by default with `en` fallback. Strings live in `src/i18n/dictionaries.ts`; the active locale is stored in the `qcaas.locale` cookie and switched from the header toggle.
