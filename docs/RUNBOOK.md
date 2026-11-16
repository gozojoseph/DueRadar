# DueRadar production runbook

Operational procedures for the Render web service, the reminder worker, Neon Postgres, Neon Auth,
Resend and web push. Keep this file current whenever infrastructure or a secret changes.

## 1. Service map

| Component        | Where                                  | Health / signal                          |
| ---------------- | -------------------------------------- | ---------------------------------------- |
| Web + API        | Render Frankfurt, Docker web service   | `GET /api/health` returns 200 and `database: ok` |
| Reminder worker  | Render Frankfurt, Docker worker        | JSON logs: `Worker started`, `Maintenance complete`, `Reminder delivered` |
| Database         | Neon `aws-eu-west-2` (London)          | Neon console metrics, connection count   |
| Auth             | Neon Auth branch, proxied by the API   | `/api/auth/get-session`, Neon Auth logs  |
| Transaction email| Resend                                 | Resend delivery log and webhook attempts |
| Push             | Browser push services (APNs/FCM/Mozilla)| Worker delivery logs and device rows     |

One Docker image serves the API/PWA and also runs the worker with a different command. Both
services start migrations under advisory lock `728_491_002`.

## 2. Pre-deploy checklist

- [ ] `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`, `pnpm build` pass locally or in CI.
- [ ] Any schema change has a generated migration in `packages/db/migrations/` and was reviewed.
- [ ] New environment variables are present in both Render services, not just the web service.
- [ ] The target Neon branch is the intended one (production vs staging), with a recent restore point.
- [ ] Resend domain and DNS records are verified; the API key has sending permission only.
- [ ] `APP_ORIGIN` matches the hostname users will open, and that origin is trusted in Neon Auth.
- [ ] `render.yaml` and the Render dashboard agree on plans, regions and commands.

## 3. Deploy

Blueprint flow (preferred):

1. Push the reviewed commit to `main`.
2. Render builds the Docker image once per service. The web service waits for `/api/health`.
3. Watch the web deploy log for `[db] Migrations applied` and `DueRadar API listening`.
4. Watch the worker log for `Worker started` and the first `Maintenance complete`.
5. Run the post-deploy checks below.

Manual flow: create a Docker web service and a Docker worker from the same repository and Dockerfile.
Web command is the image default. Worker command is
`pnpm --filter @dueradar/worker start`. Set the variables listed in `.env.example`, with
`SERVE_WEB=true`, `WEB_DIST=/app/apps/web/dist`, `NODE_ENV=production` and `RUN_MIGRATIONS=true`.

### Post-deploy checks

```bash
curl -fsS https://app.dueradar.cloud/api/health
curl -fsS https://app.dueradar.cloud/api/v1/config
curl -fsS https://app.dueradar.cloud/api/auth/get-session
curl -fsS -o /dev/null -w '%{http_code}\n' https://app.dueradar.cloud/
```

Expected: health 200 with `database: ok`; config exposes only the public VAPID key and Ghana-first
defaults; anonymous session returns `null`; the app returns 200 with the PWA document. Verify
`Content-Security-Policy`, `X-Content-Type-Options`, HSTS and `Cache-Control` on `sw.js`.

Then sign in with a test account, load the dashboard, and confirm the worker is polling without
errors.

## 4. Rollback

1. In Render, open the service → Deploys and redeploy the previous healthy commit. This is the
   fastest safe rollback because it reuses the prior image.
2. If the worker is producing bad reminders, suspend the worker first, roll back the web service,
   then roll back and resume the worker.
3. Database migrations are forward-only. Do not delete migration rows or hand-edit the schema.
   If a deploy failed after applying a migration, roll back the application and write a corrective
   migration; restore from a Neon branch/restore point only when data is corrupted and the loss
   window is acceptable.
4. After rollback, re-run the post-deploy checks and inspect reminders created during the bad
   window (`reminder_jobs`), cancelling or rescheduling where needed through the app.

## 5. Database operations

- Use the **pooled** host for the web service and worker. Use the **direct** host only for
  maintenance that cannot go through the pooler.
- Startup migrations serialize on advisory lock `728_491_002`; a stuck lock usually means a
  half-open migration session. Find it in `pg_locks`/`pg_stat_activity`, confirm the session is
  dead, then terminate it. Never run two migration processes manually.
- Before risky work, create a Neon branch or restore point. Neon branches are copy-on-write and are
  the preferred way to test a migration against production-shaped data.
- Backups inherit Neon's retention window. Do not promise users that a deleted account can be
  restored from backup; the product deliberately treats deletion as immediate.
- To verify retention, query counts for raw imports older than 72 hours, webhook payloads older than
  30 days, and audit/delivery rows older than 12 months. The worker runs these cleanups every six
  hours.

## 6. Worker and reminder queue

- The queue is `reminder_jobs`, claimed with `FOR UPDATE SKIP LOCKED` and a 10-minute lease.
- Failed deliveries retry up to five times with 2/4/6/8-minute backoff. Permanent failures are marked
  failed and logged; they do not block other jobs.
- Dedupe keys: `<occurrenceId>:<channel>:<offsetDays>` for planned reminders and
  `<occurrenceId>:snooze:<date>:<channel>` for snoozes.
- The worker refreshes the next 75 days of jobs every six hours and reclaims stale leases on every
  poll.
- If email or push is not configured, delivery is skipped with a warning rather than crashing. Check
  `emailConfigured` and `pushConfigured` in the startup log.
- A growing queue with no deliveries usually means bad Resend credentials, an exhausted push
  subscription, or a worker that cannot reach Neon. Check the worker log first, then Resend, then the
  database connection count.

## 7. Email and inbound forwarding

- Resend verifies the sending domain; keep SPF, DKIM and DMARC intact. Never send from an unverified
  domain or a personal mailbox.
- Neon Auth uses Resend SMTP for verification, reset and OTP mail. Test it after any credential
  change with a real inbox.
- The inbound catch-all posts to `/api/webhooks/resend`. The route verifies the signing secret;
  payloads are retained for troubleshooting for 30 days and then purged.
- Resend idempotency keys are derived per reminder job. Re-running the same job must not send a
  duplicate; if duplicates appear, inspect the job key before changing delivery code.
- If deliverability drops: check Resend bounce/complaint events, confirm DNS, then check whether the
  recipient address is on a suppression list. Do not remove suppressions blindly.

## 8. Secrets and rotation

| Secret                  | Rotation impact                                                        |
| ----------------------- | ---------------------------------------------------------------------- |
| `DATABASE_URL` password | Update Neon role password, then both Render services; old connections drain |
| `RESEND_API_KEY`        | Update web + worker + Neon Auth SMTP; send a test email                 |
| `RESEND_WEBHOOK_SECRET` | Update Render and the Resend webhook endpoint together                  |
| VAPID key pair          | Rotating invalidates every existing browser subscription; users must re-enable push |
| Neon Auth config        | Changes may invalidate sessions or redirect handling; test on staging first |

Store secrets only in Render's encrypted environment variables and the provider dashboards. Never
paste them into issues, chat, logs or the repository. `.env.local` is for local development only.

## 9. Monitoring

Minimum weekly checks:

- Render deploy history and service restarts.
- `/api/health` latency and any 5xx spikes in Render logs.
- Worker `Reminder delivery failed` and `Maintenance failed` entries.
- Neon connection count, storage, and slow queries.
- Resend bounce/complaint rates and inbound webhook failures.
- Auth failures: `INVALID_ORIGIN`, `MISSING_ORIGIN`, `INVALID_HOSTNAME`, unexpected 5xx.

There is no third-party analytics or advertising pixel. Do not add one without updating the privacy
notice and, where required, obtaining consent.

## 10. Incident response

1. **Contain.** Suspend the worker or roll back the web service if the incident involves outbound
   reminders, auth or data exposure. Revoke a leaked secret at the provider before anything else.
2. **Assess.** Identify affected users, records, time window and whether data left DueRadar. Preserve
   relevant logs; do not copy personal data into tickets.
3. **Notify.** Follow Ghana's Data Protection Act, 2012 (Act 843) and the Data Protection
   Commission's breach guidance. Tell affected users clearly what happened and what they should do.
   Legal copy must not claim DPC registration is complete until it is.
4. **Recover.** Restore service, verify health, reconcile reminder jobs, and confirm no duplicate
   sends.
5. **Review.** Write a short blameless post-incident note: cause, impact, detection, fix, follow-up.
   Add a regression test where possible.

For a suspected account compromise: revoke sessions, reset the password, review audit events, and
check device registrations. Account deletion remains available even during support disputes.

## 11. Data subject requests

- **Access/export:** Settings → export produces JSON for the signed-in user. Support should not
  export another account's data manually.
- **Correction:** the user edits their own records in the app.
- **Deletion:** the account page deletes app rows and `neon_auth` identity rows in one transaction,
  clears the scoped session cache, and expires both `better-auth.*` and `neon-auth.*` cookies. A
  bearer token that has not yet expired is refused because every `/api/v1` bearer request checks the
  auth user row still exists. It is immediate and cannot be undone. One non-identifying audit record
  remains until audit retention expires.
- Verify the requester controls the account email before discussing any account details. Do not ask
  for passwords, OTPs or card data.
- Log the request and outcome without storing the user's bill contents in the support system.

## 12. M0 acceptance gate

Run this on production or staging with real devices before starting detection work. Record the date,
build/commit, devices and result.

- [ ] Sign-up with a real inbox; verification OTP arrives; email is verified.
- [ ] Sign-in with password and with emailed code; session survives refresh and PWA relaunch.
- [ ] Safari iOS accepts the first-party cookie; no redirect loop or immediate sign-out.
- [ ] Android Chrome and iOS Home Screen push both deliver; tapping opens the correct record.
- [ ] Dashboard, subscriptions, occurrences and calendar agree on projected vs paid state.
- [ ] Quiet hours suppress delivery; changing preferences re-plans future reminders.
- [ ] JSON export downloads and excludes push keys and raw imports.
- [ ] Account deletion removes data and credentials; the same email can start a clean account.
- [ ] `/privacy`, `/terms`, `/security` match actual subprocessors, retention and DPC wording.
- [ ] Resend inbound webhook verifies signatures and rejects unsigned requests.
- [ ] Rollback was rehearsed once on staging.

Only after this gate should Phase 2 detection work begin.

## 13. Known limits

- No social login in Phase 1; no two-factor authentication yet.
- No native Android SMS reading and no bank/issuer integrations. Gmail stays off until Google
  verification/CASA; partner adapters stay behind flags.
- Projections are estimates, clearly labelled, and must never be presented as confirmed charges.
- Render has no London region; Frankfurt is the chosen compromise (~15 ms to Neon London).
- The service is not a payment processor and never stores full card or mobile-money credentials.
