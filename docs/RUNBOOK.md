# DueRadar production runbook

Operational procedures for the Render web service, the reminder worker, Neon Postgres, Neon Auth,
Resend, Paystack and web push. Keep this file current whenever infrastructure or a secret changes.

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
- [ ] New environment variables are set on the service that consumes them. The API needs
  `PAYSTACK_SECRET_KEY`; both web and worker need `INBOUND_EMAIL_DOMAIN` and
  `DETECTION_RAW_RETENTION_HOURS` because the worker purges expired raw text.
- [ ] The target Neon branch is the intended one (production vs staging), with a recent restore point.
- [ ] Resend sending domain and DNS records are verified; the API key has the least permissions that
  still allow sending and reading received email. A leaked full-access key must be rotated.
- [ ] If forwarding is enabled, the receiving domain shows verified and the `email.received` webhook
  is active with the current signing secret.
- [ ] For paid checkout, configure the Paystack secret on the Render web service and create a
  Paystack webhook for `https://app.dueradar.cloud/api/webhooks/paystack`.
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
  hours. Phase 2 also clears `subject`, `from_address` and `message_id` when raw text expires, and
  keeps failed imports only until their 72-hour deadline.

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

## 7. Email, forwarding and detection

**Sending.** Resend verifies the sending domain; keep SPF, DKIM and DMARC intact. Never send from an
unverified domain or a personal mailbox. Neon Auth uses Resend SMTP for verification, reset and OTP
mail; test it after any credential change with a real inbox. Resend idempotency keys are derived per
reminder job. Re-running the same job must not send a duplicate; if duplicates appear, inspect the job
key before changing delivery code. If deliverability drops, check Resend bounce/complaint events,
confirm DNS, then check whether the recipient is suppressed. Do not remove suppressions blindly.

**Receiving.** `INBOUND_EMAIL_DOMAIN` names the domain behind every user's forwarding address
(`dr-<random>@<domain>`). Add the MX record Resend provides and wait for the domain to show verified
and receiving enabled. Resend's managed `<id>.resend.app` domain can stand in while custom DNS is
blocked; the app displays whichever domain is configured.

1. Resend posts an `email.received` event to `POST /api/webhooks/resend`.
2. The route verifies `svix-id`, `svix-timestamp` and `svix-signature` against
   `RESEND_WEBHOOK_SECRET`; unsigned, stale or altered payloads get 401 and are never parsed.
3. The event is deduplicated by provider event ID in `webhook_events`. A previously failed event is
   reprocessed when the duplicate arrives, so a retryable failure can recover.
4. The recipient list is matched to an active alias, including `+tag` variants. Revoked aliases never
   match. Unknown recipients are ignored.
5. The body is fetched once from
   `GET https://api.resend.com/emails/receiving/{email_id}?html_format=cid`, capped at 2 MB, with
   remote images disabled. HTML is stripped to text; attachments are counted, never opened; links are
   never followed.
6. Free text is redacted, parsed, and stored with a 72-hour retention deadline. The alias receives a
   `last_received_at` timestamp only after a successful read.

**Retry and failure handling.** A retryable failure (Resend 5xx, timeout, body fetch failure) returns
a non-2xx so Resend retries. A permanent failure (unreadable body, missing alias, oversized message)
is recorded on the import with a 72-hour deadline and acknowledged with 200. The import history shows
`Needs attention` with the reason and no raw body. Metadata-only logs are expected; never add the
body, subject or sender to logs.

**Alias rotation and revocation.** Users can replace or revoke their address in `/import` → Email.
Rotation invalidates the old address immediately because matching is by active alias row, not by
domain pattern. Revocation does the same. Mail already forwarded is unaffected and may still appear
if it arrives before the revocation commits.

**Detection review.** Imported messages create drafts only; nothing becomes a record until accepted in
`/detections`. If the review inbox shows a suggestion with a blocked reason, it is a refund, decline,
card check, transfer or other non-charge and must not be saved as a bill. If an accepted record has
the wrong anchor, correct it in the record form; do not edit detection rows by hand.

**Diagnosing a missing forward.** Check, in order: the address shown in the app matches
`INBOUND_EMAIL_DOMAIN`; the Resend receiving domain is verified; the webhook delivery log shows a
2xx; `webhook_events` has the event; the alias row is active; the import row exists and its status.
If the body was fetched but unreadable, the import says `no_readable_text`; ask the user to paste the
text instead rather than loosening the size or attachment rules.

## 8. Paystack billing

Plus checkout is a manually renewed, one-time purchase: GHS 9.99 for one month or GHS 99 for twelve
months. It never creates an automatic recurring charge. Renewal extends any unexpired paid term;
existing grandfathered accounts keep lifetime Plus and should not be asked to pay.

1. Create/activate the DueRadar merchant account in Paystack and confirm that the account supports
   the payment methods and settlement arrangements intended for launch.
2. Set `PAYSTACK_SECRET_KEY` only on the Render web/API service. Never add it to the frontend,
   worker, repository, chat or logs. `.env.example` contains only an empty placeholder.
3. In Paystack, configure a webhook pointing to `https://app.dueradar.cloud/api/webhooks/paystack`.
   Use the secret key configured for the account in Render as `PAYSTACK_SECRET_KEY`; do not invent a
   separate webhook secret.
4. Deploy and test with Paystack test mode on staging. Confirm successful verification activates the
   expected term, while an altered signature, wrong amount/currency, failed transaction, duplicate
   webhook and another user's reference do not grant access.
5. Before live charges, confirm Paystack's contracting entity, processing locations, refund handling
   and merchant terms; update `docs/DPC.md` and the privacy/terms copy if those facts differ.

The browser return to Settings is not proof of payment. The API verifies every reference with
Paystack; the signed webhook does the same. A payment remains pending until provider verification
succeeds. Investigate pending references in Paystack and the `billing_transactions` row; do not
manually set a profile to Plus to work around an uncertain payment.

## 9. Secrets and rotation

| Secret                  | Rotation impact                                                        |
| ----------------------- | ---------------------------------------------------------------------- |
| `DATABASE_URL` password | Update Neon role password, then both Render services; old connections drain |
| `RESEND_API_KEY`        | Update web + worker + Neon Auth SMTP; confirm it can send and read received email; send a test |
| `RESEND_WEBHOOK_SECRET` | Update Render and the Resend webhook endpoint together; old signatures stop verifying |
| `PAYSTACK_SECRET_KEY` | Update Render and the Paystack webhook configuration together; old signatures and API credentials stop verifying |
| `INBOUND_EMAIL_DOMAIN`  | Changing the domain changes every future address; existing aliases keep their stored address |
| `DETECTION_LLM_API_KEY` | Only used when the fallback is enabled; rotate at the provider and update Render |
| VAPID key pair          | Rotating invalidates every existing browser subscription; users must re-enable push |
| Neon Auth config        | Changes may invalidate sessions or redirect handling; test on staging first |

Store secrets only in Render's encrypted environment variables and the provider dashboards. Never
paste them into issues, chat, logs or the repository. `.env.local` is for local development only.

## 10. Monitoring

Minimum weekly checks:

- Render deploy history and service restarts.
- `/api/health` latency and any 5xx spikes in Render logs.
- Worker `Reminder delivery failed` and `Maintenance failed` entries.
- Neon connection count, storage, and slow queries.
- Resend bounce/complaint rates and inbound webhook failures.
- Paystack webhook/API failures, pending billing transactions, and mismatches between verified
  transactions and active Plus terms.
- Import failures: count of `imports.status = 'failed'` in the last 24 hours, and rows still holding
  raw text past `raw_retention_until`. A non-zero overdue count means the worker cleanup is not running.
- Auth failures: `INVALID_ORIGIN`, `MISSING_ORIGIN`, `INVALID_HOSTNAME`, unexpected 5xx.

There is no third-party analytics or advertising pixel. Do not add one without updating the privacy
notice and, where required, obtaining consent.

## 11. Incident response

1. **Contain.** Suspend the worker or roll back the web service if the incident involves outbound
   reminders, auth or data exposure. Revoke a leaked secret at the provider before anything else.
2. **Assess.** Identify affected users, records, time window and whether data left DueRadar. Preserve
   relevant logs; do not copy personal data into tickets.
3. **Notify.** Follow Ghana's Data Protection Act, 2012 (Act 843) and the Data Protection
   Commission's breach guidance. Tell affected users clearly what happened and what they should do.
   Use the contacts and assessment steps in `docs/DPC.md`. Legal copy must not claim DPC registration
   is complete until it is.
4. **Recover.** Restore service, verify health, reconcile reminder jobs, and confirm no duplicate
   sends.
5. **Review.** Write a short blameless post-incident note: cause, impact, detection, fix, follow-up.
   Add a regression test where possible.

For a suspected account compromise: revoke sessions, reset the password, review audit events, and
check device registrations. Account deletion remains available even during support disputes.

## 12. Data subject requests

- The statutory response deadline is **40 days** from receipt (Act 843 s.35(5)). Log the request date
  and due date immediately. The full procedure is in `docs/DPC.md` section 6.
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

## 13. M0 and Phase 2 acceptance gates

Run the M0 gate on production or staging with real devices, then the Phase 2 gate with fixtures or a
staging account. Record the date, build/commit, devices and result.

**M0 gate**

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

**Phase 2 gate**

- [ ] A MoMo alert creates a pending draft with evidence; no record exists until accepted.
- [ ] A card check, refund and decline are blocked and cannot be accepted.
- [ ] A trial with a stated duration calculates the end date; a missing one is requested.
- [ ] A one-off charge asks for the next renewal date instead of guessing.
- [ ] Forwarding works end to end, including a `+tag` address, and the alias timestamp updates.
- [ ] Rotation stops the old address; revocation stops new mail; neither resurrects old drafts.
- [ ] CSV preview maps headers, flags duplicate rows and imports a three-charge candidate.
- [ ] Re-importing the same CSV creates no duplicate suggestions.
- [ ] Screenshot OCR completes on Chrome and Safari without uploading the image; text is editable.
- [ ] Accepting a draft creates the record with the correct anchor and up to 24 payments; dismissing
      persists so the same message is not proposed again.
- [ ] An import with status `failed` shows its reason and stores no raw body.
- [ ] Raw text, subject and sender disappear after the retention window; suggestions remain.
- [ ] Rollback was rehearsed once on staging.

## 14. Known limits

- No social login and no two-factor authentication yet.
- Detection is deterministic and English-first. Unusual formats, non-English receipts and images with
  handwriting may fail; the fallback is the Paste tab, not looser parsing.
- Attachments are never opened and remote content is never loaded, so a receipt that exists only as a
  PDF or image attachment will be reported as unreadable. Screenshot OCR is client-side only.
- CSV import reads a single statement at a time, up to 2 MB and 5,000 rows. It does not reconcile
  across banks or currencies; cross-source duplicates are estimates, not authoritative.
- Gmail, bank and issuer integrations remain off. Gmail requires Google restricted-scope
  verification/CASA; partner adapters require verified agreements.
- The optional LLM fallback is off by default and only fills fields the parsers left empty. It is not
  a source of truth and must not be enabled without updating the DPC/ROPA record.
- Recurring candidates need three matching successful charges; two charges are shown for context but
  are not proposed as a recurrence.
- Projections are estimates, clearly labelled, and must never be presented as confirmed charges.
- Render has no London region; Frankfurt is the chosen compromise (~15 ms to Neon London).
- The service is not a payment processor and never stores full card or mobile-money credentials.
