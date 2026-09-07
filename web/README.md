# QCaaS Web

Next.js (App Router, TypeScript, Tailwind) frontend for the QCaaS FastAPI backend.

## Local development

1. Start the backend on `http://localhost:8000` (from the repo root, e.g. `uvicorn qcaas.main:app --reload`). CORS must allow `http://localhost:3000`.
2. In `web/`:

   ```bash
   npm ci
   cp .env.example .env.local   # NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
   npm run dev                  # http://localhost:3000
   ```

3. Open **Settings**, paste your API key (sent as `X-API-Key`) and, optionally, a payload key (sent as `X-Payload-Key`). Both live in `sessionStorage` for the current tab only. "Save & test" calls `GET /healthz` and `GET /v2/jobs?limit=1`.

The header **API Docs** link opens `${NEXT_PUBLIC_API_BASE_URL}/docs` (Swagger UI).

### Scripts

| Script              | Purpose                                                        |
| ------------------- | -------------------------------------------------------------- |
| `npm run dev`       | Dev server                                                     |
| `npm run build`     | Production build                                               |
| `npm start`         | Serve the production build                                     |
| `npm run lint`      | ESLint                                                         |
| `npm run typecheck` | `tsc --noEmit`                                                 |
| `npm test -- --run` | Vitest (jsdom + Testing Library)                               |
| `npm run gen:api`   | Regenerate `src/lib/api/schema.d.ts` from `../docs/openapi.json` |

## Environment variables

| Variable                   | Description                                             |
| -------------------------- | ------------------------------------------------------- |
| `NEXT_PUBLIC_API_BASE_URL` | Backend base URL, no trailing slash. Default `http://localhost:8000`. |

It is inlined at build time (`NEXT_PUBLIC_*`), so each Vercel environment needs its own value:

| Vercel environment | Value                       |
| ------------------ | --------------------------- |
| Development        | `http://localhost:8000`     |
| Preview            | staging API URL             |
| Production         | production API URL          |

## Deploying on Vercel

- Connect the Git repository and set the project **Root Directory** to `web/`. Vercel's Git integration builds and deploys from that directory (`vercel.json` pins `framework: nextjs`).
- Add `NEXT_PUBLIC_API_BASE_URL` per environment as above; redeploy after changing it.
- Make sure the backend's CORS allow-list includes the Vercel preview and production origins.

## Regenerating API types

Whenever the backend contract changes, re-export `docs/openapi.json` from FastAPI, then:

```bash
npm run gen:api
npm run typecheck
```

`src/lib/api/schema.d.ts` is committed; `src/lib/api/types.ts` re-exports the schemas used by the UI, and `src/lib/api/client.ts` is the typed fetch wrapper (adds auth headers, surfaces backend `{error, detail, code}` as `ApiError`, and exposes `X-RateLimit-*`).

## i18n

Locale is `zh-TW` by default with `en` fallback. Strings live in `src/i18n/dictionaries.ts`; the active locale is stored in the `qcaas.locale` cookie and switched from the header toggle.
