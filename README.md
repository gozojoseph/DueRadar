# DueRadar

DueRadar is a mobile-first tracker for bills, subscriptions, prepaid plans, instalments and free
trials, built for Ghana. It defaults to **GHS** and **Africa/Accra**, keeps every charge in its
original currency, and sends reminders before a date becomes expensive to miss.

This repository contains the Phase 1 product plus Phase 2 detection: verified-email accounts, the
full record and schedule model, reminders by email/push/in-app, calendar, export, account deletion,
legal pages, an installable PWA, and a confirm-first review inbox fed by pasted messages, forwarded
email, CSV statements and on-device screenshot OCR. Provider connections such as Gmail remain a
later phase.

## Stack

| Layer      | Choice                                                                 |
| ---------- | ---------------------------------------------------------------------- |
| Web        | Vite, React 19, TypeScript, Tailwind CSS 4, React Router, TanStack Query |
| PWA        | `vite-plugin-pwa` / Workbox, custom push handlers, generated icons      |
| API        | Fastify 5, Zod, Drizzle ORM, `jose` JWT verification                    |
| Worker     | Node process polling a Postgres-backed reminder queue                  |
| Database   | Neon Postgres (London), Drizzle migrations under an advisory lock       |
| Auth       | Neon Auth / Managed Better Auth, proxied same-origin at `/api/auth/*`   |
| Email      | Resend for verification, reminders and inbound receiving                |
| Detection  | Deterministic parsers, CSV, client-side Tesseract OCR, optional redacted LLM |
| Push       | Web Push with VAPID                                                     |
| Deployment | Render Frankfurt, one Docker web service plus one background worker     |

Shared logic lives in `packages/domain` (money, dates, recurrence, scheduling rules), `packages/db`
(schema and migrations), `packages/detection` (pure parsers, recurrence, CSV and redaction),
`packages/email`, `packages/push` and `packages/scheduling` (reminder planning, queue, delivery,
retention).

## Repository layout

```
apps/
  api/        Fastify API, auth proxy, static SPA serving
  web/        React PWA
  worker/     reminder delivery loop
packages/
  db/         Drizzle schema, migrations, migration runner
  detection/  pure parsers, recurrence detection, CSV mapping, redaction
  domain/     currency, calendar and recurrence rules
  email/      Resend client and templates
  push/       Web Push client
  scheduling/ planning, queue claim/complete, delivery, retention
docs/
  RUNBOOK.md  deploy, rollback, incident and acceptance procedures
  DPC.md      Ghana Data Protection Commission registration pack
  DNS.md      Resend, DMARC and app DNS records
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
pnpm test        # domain + detection + API suites (currently 125 tests)
pnpm build       # typecheck and production PWA build
```

The API suite covers environment validation, cookie policy, request schemas, routing, security
headers, health behaviour, authentication rejection, detection accept/reject mapping, retention
boundaries, alias plus-address matching, Resend event parsing, webhook signatures and account-deletion
regressions: a deleted account's bearer token and cached cookie session cannot recreate a profile.
Domain tests cover money, date arithmetic, recurrence and reminder planning. Detection tests cover
Ghanaian MoMo and card alerts, trial and renewal notices, recurring-charge evidence, CSV mapping and
redaction.

## Environment

See `.env.example` for the complete annotated list. The important production values are:

| Variable                | Purpose                                                           |
| ----------------------- | ----------------------------------------------------------------- |
| `DATABASE_URL`          | Neon Postgres connection string (pooled host for the app)         |
| `NEON_AUTH_BASE_URL`    | Branch Auth base URL; proxied at `/api/auth/*`                    |
| `ADMIN_EMAILS`          | Comma-separated verified emails allowed to use the admin dashboard |
| `APP_ORIGIN`            | Public web origin, e.g. `https://app.dueradar.cloud`              |
| `SERVE_WEB` / `WEB_DIST`| Enable SPA serving and point at `/app/apps/web/dist`              |
| `RESEND_API_KEY`        | Resend key for auth mail, reminders and received-email bodies     |
| `RESEND_WEBHOOK_SECRET` | Svix signing secret for the inbound receiving webhook             |
| `INBOUND_EMAIL_DOMAIN`  | Domain behind forwarding addresses, e.g. `in.dueradar.cloud`      |
| `DETECTION_RAW_RETENTION_HOURS` | Raw text lifetime, 1–72 hours; default 72                 |
| `DETECTION_LLM_*`       | Optional redacted fallback; off unless explicitly enabled         |
| `VAPID_*`               | Web Push key pair and contact subject                             |
| `COOKIE_SECURE`         | Force Secure cookies (defaults from the `APP_ORIGIN` scheme)      |

`INBOUND_EMAIL_DOMAIN` must be a bare domain with no scheme or `@`. The optional LLM fallback is only
active when `DETECTION_LLM_ENABLED=true` and a URL, key and model are all present; it sends redacted
text capped at 4,000 characters and fills only fields the deterministic parsers left empty.

Never commit `.env.local`. The repository ignores it, and `.dockerignore` keeps it out of images.

## Deployment

1. Create a production Neon branch from `main` and note the pooled connection string.
2. Enable Neon Auth on that branch. Add `https://app.dueradar.cloud` as a trusted domain (and
   `http://localhost:5173` while localhost access is enabled).
3. Verify `dueradar.cloud` in Resend. Add the SPF, DKIM and DMARC records Resend provides.
4. Create the Render Blueprint from `render.yaml`, or create the Docker web service and worker
   manually. Set the `sync: false` variables in the Render dashboard:
   `DATABASE_URL`, `NEON_AUTH_BASE_URL`, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`,
   `INBOUND_EMAIL_DOMAIN`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `ADMIN_EMAILS`.
   Set `ADMIN_EMAILS` to the comma-separated address(es) of verified DueRadar accounts that
   should administer the service. Remove an administrator from this allowlist before suspending
   their account.
5. Point `app.dueradar.cloud` at Render and let TLS issue.
6. Configure Neon Auth SMTP with Resend (`smtp.resend.com`, port 465, user `resend`, the API key as
   password) so verification and reset emails come from `dueradar.cloud`.
7. Enable Resend receiving for `in.dueradar.cloud`: add the MX record Resend provides, then wait for
   the domain to show **verified / receiving enabled**. Until a custom domain is verified, Resend's
   managed `<id>.resend.app` receiving domain can be used by pointing `INBOUND_EMAIL_DOMAIN` at it.
8. Add a Resend webhook for `email.received` to `https://app.dueradar.cloud/api/webhooks/resend` and
   copy its signing secret into `RESEND_WEBHOOK_SECRET`. The route rejects unsigned payloads.
9. Run the M0 acceptance checklist below, then the Phase 2 checks, before inviting users.

The web service serves the API and the built PWA from one origin, which keeps the session cookie
first-party for Safari. The worker shares the image and starts with
`pnpm --filter @dueradar/worker start`. Both services use paid Render plans because background
workers are not available on the free plan.

Inbound mail is fetched once from `GET https://api.resend.com/emails/receiving/{email_id}` with
`html_format=cid`, so remote images are replaced by content IDs rather than downloaded. HTML is
stripped, bodies are capped at 2 MB, and attachments are counted but never opened. A permanent
failure is recorded on the import and acknowledged with 200 so Resend stops retrying; a retryable
failure returns a non-2xx and is reprocessed when the duplicate webhook arrives.

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

## Phase 2 detection and review inbox

Detection is **confirm-first**. No message ever creates a bill, subscription or trial by itself. A
draft appears in `/detections`; accepting it is the only path to a record, and accepting reuses the
same ownership and scheduling code as manual entry.

| Input | Path | Notes |
| --- | --- | --- |
| Pasted text | `/import` → Paste | MoMo alerts, card alerts, renewals, trial notices, receipts |
| Forwarded email | `/import` → Email | Private per-user address, rotating and revocable |
| CSV statement | `/import` → CSV | Header/date mapping, preview, row errors, dedupe |
| Screenshot | `/import` → Screenshot | Tesseract runs in the browser; only extracted text is uploaded |

The rules the parsers enforce:

- A **zero-value card check** is not a trial or a subscription. Refunds, reversals, declines, wallet
  transfers and unrecognised transaction types are stored as `kind: "payment"` with a blocked reason
  so the message is accounted for but cannot become a record.
- A single successful charge without renewal details becomes a payment draft. It asks for a future
  renewal date instead of inventing a recurrence from the charge date.
- A recurring candidate needs **three matching successful charges**. Merchant aliases, interval
  drift, amount changes, refunds and multiple plans per merchant are considered, and cross-source
  duplicates are suppressed.
- Trials keep **trial expiry** and **first paid charge** as separate dates. A stated duration
  calculates the end date; a missing date is requested, not estimated.
- Every draft carries evidence snippets and warnings. The review screen shows them and lets the user
  override name, vendor, kind, amount, currency, cycle, anchor date, trial end, category, method and
  notes.

Accepting a suggestion claims it first (so a double tap cannot create two records), creates the
record through the normal service, and records up to 24 confirmed historical payments from the
import. Dismissing persists the dedupe key, so the same message is not proposed again.

CSV import runs recurrence detection across the mapped rows. Individual rows are summarised, not
turned into suggestions; only candidates with at least three successful charges are surfaced. The
file is parsed in memory and never stored.

### Phase 2 acceptance checks

Run these with fixtures or a staging account before inviting users:

- [ ] Paste a Ghanaian MoMo debit alert; a payment draft appears with evidence and no record exists until you save.
- [ ] Paste a card check, a refund and a decline; each is blocked and no accept button is offered.
- [ ] Paste a trial confirmation with a stated duration; the trial end is calculated and the first charge stays empty.
- [ ] Paste a renewal notice with no date; the review screen requires a next payment date before saving.
- [ ] Forward a real email to the address, including a `+tag` variant; it resolves to the same account and the alias shows a received timestamp.
- [ ] Replace the forwarding address; mail to the old address is no longer processed. Revoke it; new mail is ignored.
- [ ] Import a CSV with a header row, a debit column and at least three matching charges; the preview matches, duplicates are flagged, and one candidate is proposed.
- [ ] Import a CSV with a bad date row; the row is counted as an error and the rest still imports.
- [ ] Re-import the same CSV; no duplicate suggestions appear.
- [ ] Pick a screenshot in Chrome and Safari; OCR completes on-device, the network panel shows no image upload, and the text can be edited before import.
- [ ] Save a suggestion; the record appears in Tracked with the correct anchor, cycle and payment history. Dismiss another and confirm it does not return.
- [ ] Delete an import from `/import`; its suggestions go with it and saved records remain.

## Data handling defaults

- Time zone `Africa/Accra`; currency `GHS`; reminders at `09:00`; quiet hours `21:00–07:00`.
- Bills remind 7 and 1 days before; trials 3 and 1 days before; other records 3 and 1 days.
- Week starts Monday. Locale `en-GH`.
- Raw pasted and forwarded text is erased after 72 hours (configurable down to 1 hour); the subject
  and sender are purged on the same clock. Review decisions and record fields remain.
- Inbound webhook payloads are kept for 30 days; audit and delivery rows for 12 months.
- Forwarded bodies are fetched once with remote images disabled, stripped to readable text, and
  capped at 2 MB. Attachments are counted but never opened, and links are never followed.
- Screenshots are processed in the browser. The image is never uploaded; only the extracted text is
  sent, and only when the user chooses to find charges.
- The optional LLM fallback is off by default. When enabled it receives redacted text capped at 4,000
  characters and may fill only fields the deterministic parsers left empty.
- Deletion is immediate and transactional across application tables and `neon_auth` identity tables.
  One non-identifying audit record confirms the deletion.

## Security notes

- Every read and write is scoped by user ID at the database layer. Guessed IDs return not found.
- Public registration is email/password with required verification. There is no social login.
- The API accepts a short-lived EdDSA bearer JWT verified against the branch JWKS, or the first-party
  session cookie. An invalid bearer is rejected rather than downgraded.
- CSP is self-only except for the screenshot reader: `cdn.jsdelivr.net` supplies Tesseract's worker,
  WASM core and loader, and `tessdata.projectnaptha.com` supplies the English model. Both are used
  only when a user picks an image; no other third-party script runs, and the image itself is never
  uploaded. Keeping the image local removes a whole class of receipt-data exposure.
- Inbound webhooks require a valid Svix signature, reject stale timestamps, and deduplicate by
  provider event ID. Logs contain metadata only, never message bodies.
- Free text is redacted before storage: card and account numbers, mobile-money references and email
  local parts. A sender is stored as `[email]@provider-domain` so the provider is still recognisable.
- HSTS is enabled when the app origin is HTTPS.
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

**Screenshot reader does nothing:** Tesseract downloads its worker, WASM core and English model from
`cdn.jsdelivr.net` and `tessdata.projectnaptha.com` on first use. The CSP allows exactly those hosts.
Check the browser console for a blocked request, then retry on a network that allows them; the image
never needs to be uploaded.

**Forwarded mail never appears:** confirm `INBOUND_EMAIL_DOMAIN` matches the address shown in
`/import`, that the Resend receiving domain is verified, and that the `email.received` webhook is
delivering with a valid `RESEND_WEBHOOK_SECRET`. An import row with status `failed` records the reason
without storing the body.

## Next phase

Phase 3 adds provider connections behind flags. Gmail stays off until Google restricted-scope
verification and CASA are complete; bank and issuer adapters require verified partners. The same
confirm-first review inbox will receive those suggestions, so projections remain distinct from
confirmed charges throughout.

See [docs/RUNBOOK.md](docs/RUNBOOK.md) for deploy, rollback, incident and data-request procedures.
[docs/DPC.md](docs/DPC.md) is the Ghana Data Protection Commission registration pack and launch gate.
