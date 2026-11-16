# DueRadar

DueRadar is a mobile-first tracker for bills, subscriptions, prepaid plans, instalments and free
trials, built for Ghana. It defaults to **GHS** and **Africa/Accra**, keeps every charge in its
original currency, and sends reminders before a date becomes expensive to miss.

This repository contains the Phase 1 product: verified-email accounts, the full record and schedule
model, reminders by email/push/in-app, calendar, export, account deletion, legal pages, and an
installable PWA. Detection work is intentionally paused at the Phase 1 checkpoint.

## Stack

| Layer      | Choice                                                                 |
| ---------- | ---------------------------------------------------------------------- |
| Web        | Vite, React 19, TypeScript, Tailwind CSS 4, React Router, TanStack Query |
| PWA        | `vite-plugin-pwa` / Workbox, custom push handlers, generated icons      |
| API        | Fastify 5, Zod, Drizzle ORM, `jose` JWT verification                    |
| Worker     | Node process polling a Postgres-backed reminder queue                  |
| Database   | Neon Postgres (London), Drizzle migrations under an advisory lock       |
| Auth       | Neon Auth / Managed Better Auth, proxied same-origin at `/api/auth/*`   |
| Email      | Resend for verification, reminders and inbound forwarding               |
| Push       | Web Push with VAPID                                                     |
| Deployment | Render Frankfurt, one Docker web service plus one background worker     |

Shared logic lives in `packages/domain` (money, dates, recurrence, scheduling rules),
`packages/db` (schema and migrations), `packages/email`, `packages/push` and `packages/scheduling`
(reminder planning, queue, delivery, retention).

## Repository layout

```
apps/
  api/        Fastify API, auth proxy, static SPA serving
  web/        React PWA
  worker/     reminder delivery loop
packages/
  db/         Drizzle schema, migrations, migration runner
  domain/     currency, calendar and recurrence rules
  email/      Resend client and templates
  push/       Web Push client
  scheduling/ planning, queue claim/complete, delivery, retention
docs/
  RUNBOOK.md  deploy, rollback, incident and acceptance procedures
```

## Local development

Requirements: Node 24, pnpm 9.15.4, and a Neon project with Neon Auth enabled.

```bash
pnpm install
cp .env.example .env.local
```

Fill `.env.local` with the branch's pooled `DATABASE_URL`, its `NEON_AUTH_BASE_URL`, and a VAPID
key pair. Generate keys without committing them:

```bash
npx web-push generate-vapid-keys
```

Start the API and Vite together, then the worker in a second terminal:

```bash
pnpm dev
pnpm dev:worker
```

- Web: <http://localhost:5173>
- API: <http://localhost:3001>
- Health: <http://localhost:3001/api/health>
- Config: <http://localhost:3001/api/v1/config>

The API and worker call Node's `process.loadEnvFile` on the root `.env.local` in development.
Production never reads a file: Render injects environment variables. Variables already present in
the shell take precedence over `.env.local`.

The API runs pending migrations at startup under advisory lock `728_491_002`. The worker does the
same, so either service can deploy first. To run them manually:

```bash
pnpm db:generate   # after changing packages/db/src/schema.ts
pnpm db:migrate
```

### Local production-like check

Build the PWA and let the API serve it on one origin:

```bash
pnpm build
$env:SERVE_WEB="true"   # PowerShell; use SERVE_WEB=true elsewhere
$env:PORT="3002"
pnpm --filter @dueradar/api start
```

Then open <http://localhost:3002>. The dev server normally keeps `SERVE_WEB=false`, with Vite
proxying `/api` to port 3001.

## Verification

```bash
pnpm typecheck   # all workspace projects
pnpm test        # domain + API suites (currently 62 tests)
pnpm build       # typecheck and production PWA build
```

The API suite covers environment validation, cookie policy, request schemas, routing, security
headers, health behaviour, authentication rejection, static asset caching, and account-deletion
regressions: a deleted account's bearer token and cached cookie session cannot recreate a profile.
Domain tests cover money, date arithmetic, recurrence and reminder planning.

## Environment

See `.env.example` for the complete annotated list. The important production values are:

| Variable                | Purpose                                                           |
| ----------------------- | ----------------------------------------------------------------- |
| `DATABASE_URL`          | Neon Postgres connection string (pooled host for the app)         |
| `NEON_AUTH_BASE_URL`    | Branch Auth base URL; proxied at `/api/auth/*`                    |
| `APP_ORIGIN`            | Public web origin, e.g. `https://app.dueradar.cloud`              |
| `SERVE_WEB` / `WEB_DIST`| Enable SPA serving and point at `/app/apps/web/dist`              |
| `RESEND_API_KEY`        | Resend key for auth mail and reminders                            |
| `RESEND_WEBHOOK_SECRET` | Signing secret for inbound email forwarding                       |
| `VAPID_*`               | Web Push key pair and contact subject                             |
| `COOKIE_SECURE`         | Force Secure cookies (defaults from the `APP_ORIGIN` scheme)      |

Never commit `.env.local`. The repository ignores it, and `.dockerignore` keeps it out of images.

## Deployment

1. Create a production Neon branch from `main` and note the pooled connection string.
2. Enable Neon Auth on that branch. Add `https://app.dueradar.cloud` as a trusted domain (and
   `http://localhost:5173` while localhost access is enabled).
3. Verify `dueradar.cloud` in Resend. Add the SPF, DKIM and DMARC records Resend provides.
4. Create the Render Blueprint from `render.yaml`, or create the Docker web service and worker
   manually. Set the `sync: false` variables in the Render dashboard:
   `DATABASE_URL`, `NEON_AUTH_BASE_URL`, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`,
   `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`.
5. Point `app.dueradar.cloud` at Render and let TLS issue.
6. Configure Neon Auth SMTP with Resend (`smtp.resend.com`, port 465, user `resend`, the API key as
   password) so verification and reset emails come from `dueradar.cloud`.
7. Add the Resend inbound webhook to `https://app.dueradar.cloud/api/webhooks/resend` and copy its
   signing secret into `RESEND_WEBHOOK_SECRET`.
8. Run the M0 acceptance checklist below before moving to detection work.

The web service serves the API and the built PWA from one origin, which keeps the session cookie
first-party for Safari. The worker shares the image and starts with
`pnpm --filter @dueradar/worker start`. Both services use paid Render plans because background
workers are not available on the free plan.

### DNS summary

| Name                       | Purpose                                      |
| -------------------------- | -------------------------------------------- |
| `app.dueradar.cloud`       | Render web service (CNAME to Render target)  |
| `staging.dueradar.cloud`   | Staging web service, when created            |
| `in.dueradar.cloud`        | Resend inbound MX and catch-all forwarding   |
| SPF/DKIM/DMARC on the root | Resend sending authentication                |

Root-domain redirects to `app.` can be added after the app host is stable. Do not point the root at
the Render service until `APP_ORIGIN` and Neon Auth trusted domains match the hostname exactly.

## Phase 1 acceptance (M0 gate)

Complete this on a real iPhone (Safari) and an Android device before starting detection:

- [ ] Create an account with a real inbox; the verification code arrives and the email becomes verified.
- [ ] Sign in with password and with an emailed code. Refresh the tab and reopen the installed PWA; the session persists.
- [ ] Safari/iOS accepts the first-party auth cookie (no redirect loop, no immediate sign-out).
- [ ] Add a bill, a subscription and a free trial. Confirm projected dates are labelled as projections and never as confirmed charges.
- [ ] Mark one occurrence paid, skip another, and verify the dashboard, list and calendar agree.
- [ ] Enable push on an installed iPhone and Android, send a test push, and confirm tapping it opens the right record.
- [ ] Quiet hours suppress delivery; changing reminder time or channels re-plans future jobs.
- [ ] Export downloads a complete JSON copy and excludes device keys and raw imports.
- [ ] Delete the account with the typed confirmation. Sign-in with the same email starts a new, empty account; old data and sessions are gone.
- [ ] Check `/privacy`, `/terms` and `/security` for accurate subprocessors, retention and DPC wording.

## Data handling defaults

- Time zone `Africa/Accra`; currency `GHS`; reminders at `09:00`; quiet hours `21:00–07:00`.
- Bills remind 7 and 1 days before; trials 3 and 1 days before; other records 3 and 1 days.
- Week starts Monday. Locale `en-GH`.
- Raw imports are erased after 72 hours; inbound webhook payloads after 30 days; audit and delivery
  rows after 12 months.
- Deletion is immediate and transactional across application tables and `neon_auth` identity tables.
  One non-identifying audit record confirms the deletion.

## Security notes

- Every read and write is scoped by user ID at the database layer. Guessed IDs return not found.
- Public registration is email/password with required verification. There is no social login in
  Phase 1.
- The API accepts a short-lived EdDSA bearer JWT verified against the branch JWKS, or the first-party
  session cookie. An invalid bearer is rejected rather than downgraded.
- CSP is self-only; scripts are not loaded from third parties. HSTS is enabled when the app origin is
  HTTPS.
- Card numbers, CVVs, mobile-money PINs and bank credentials are never requested or stored.
- Legal copy says DueRadar is preparing/awaiting any required DPC registration rather than claiming
  registration is complete.

## Troubleshooting

**`INVALID_HOSTNAME` from `/api/auth/*`:** Neon Auth rejects an `x-forwarded-host` that differs from
its own host. The proxy deliberately does not send that header; forward the browser `Origin` instead.

**Database connection timeouts:** use the pooled host for the app and worker. Some one-off operations
(initial migration on a sleepy branch) may need the direct host shown in the Neon console.

**Push works on desktop but not iPhone:** iOS only delivers Web Push to a PWA installed to the Home
Screen, and `subscribeToPush` must run from a tap. Confirm the app is installed, permission is
granted, and the device row exists in Settings.

**Stale app after deploy:** the generated service worker uses `autoUpdate`. Close every tab, reopen
the app, and confirm `sw.js` is served with `Cache-Control: no-store`.

## Next phase

Phase 2 adds deterministic statement/email parsing, client-side OCR and an optional redacted LLM
fallback behind a flag. Phase 3 provider connections stay scaffolded behind flags: Gmail remains off
until Google verification/CASA, and bank/issuer adapters require verified partners. Projections must
remain distinct from confirmed charges throughout.

See [docs/RUNBOOK.md](docs/RUNBOOK.md) for deploy, rollback, incident and data-request procedures.
