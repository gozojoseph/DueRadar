# Phase 1 checkpoint

Date: 2026-11-16
Scope: M0–M2 (foundation, records and schedules, reminders and PWA)
Status: **code complete and locally verified; git initialized; deployment still blocked on domain, Render access, DNS and real devices**

## What is complete

- Mobile-first React 19 + TypeScript PWA with install support, offline shell, custom push handlers and generated icons.
- Fastify API with verified-email auth through Neon Auth/Managed Better Auth, proxied same-origin at `/api/auth/*`.
- Postgres schema and Drizzle migrations for profiles, categories, payment methods, subscriptions, occurrences, payments, imports, detection suggestions, devices, notifications, reminder jobs, delivery attempts, audit events and webhooks.
- Ghana-first defaults (`GHS`, `Africa/Accra`, `en-GH`, Monday week start, 09:00 reminders, quiet hours 21:00–07:00).
- Bills, subscriptions, prepaid plans, instalments and free trials with deterministic recurrence, end-of-month handling and projected-vs-confirmed separation.
- Dashboard, list, calendar, occurrence pay/skip/unpay/unskip/snooze, JSON/CSV export and account deletion.
- Reminder planner and Postgres queue (`FOR UPDATE SKIP LOCKED`, leases, retries, dedupe) with email, push and in-app delivery plus retention cleanup.
- One Docker image for the Render web service and worker, `render.yaml`, CI, `.env.example`, README and operations runbook.
- Legal pages with accurate subprocessors, retention and DPC wording.

## Security fix verified at this checkpoint

A deleted account could previously be resurrected by a still-valid bearer JWT: `ensureProfile` would
insert a fresh profile because the token remained cryptographically valid for up to 15 minutes. Fixed:

1. `ensureProfile` now checks that `neon_auth."user"` still exists before creating a profile and
   throws 401 otherwise.
2. A global `/api/v1` guard checks every bearer request against the auth user row, so routes that
   only call `requireUser` cannot create ghost rows for a deleted account.
3. Account deletion clears the 30-second cookie-session cache.
4. Account deletion expires both `better-auth.*` and `neon-auth.*` session cookies, including
   `__Secure-` variants with the required `Secure` attribute.

Regression coverage: rejected deleted bearer, allowed live bearer, cookie path untouched, no profile
insert for a deleted auth user, cache invalidation, and all eight cookie names cleared.

## Retention correction

The privacy notice promised 12-month retention for delivery attempts and for the non-identifying
deletion audit row, but the maintenance job did not purge either. `runRetention` now deletes delivery
attempts and all audit events older than 365 days (including `account.deleted`), and the worker logs
`purgedDeliveryAttempts`. Boundary tests cover the 30-day webhook and 12-month audit/delivery cutoffs.

## Verification evidence

| Check | Result |
| --- | --- |
| `pnpm typecheck` | all 8 workspace projects pass |
| `pnpm test` | 18 domain + 47 API = 65 tests pass |
| `pnpm build` | production PWA builds, 15 precache entries |
| Local API against Neon main | health/config/401/404/auth proxy/static PWA all correct |
| Local worker | migrations, startup, maintenance cycle and push configuration verified |
| Staging API against Neon staging | full account lifecycle passed (below) |

Staging lifecycle used a disposable Guerrilla Mail inbox and Neon Auth's shared email provider:

1. Sign-up created an unverified user; verification email arrived.
2. OTP verification returned a session and `emailVerified: true`.
3. Onboarding, subscription creation, occurrence projection, pay, dashboard, calendar, export and
   ownership-404 all returned expected data.
4. Deletion returned 204, expired all auth cookies, and every later request with the old cookie
   returned 401.
5. The auth user, profile, subscriptions and payments were gone; one non-identifying audit row was
   retained.
6. Sign-in with the deleted credentials failed; the same email could register a fresh empty account,
   which was verified and deleted again.

The OTP was recovered by matching Better Auth's stored SHA-256 OTP hash on staging. This is a test
technique only; production uses the real inbox.

## Blocked M0 gates

| Gate | Blocker |
| --- | --- |
| Render deployment | no Render workspace access or billing confirmation |
| Production email | no Resend key, verified sending domain, MX/inbound secret or real test inbox |
| HTTPS/custom domain | DNS control for `dueradar.cloud` not confirmed |
| Safari/iOS and push acceptance | no physical iPhone or Android device |
| Docker image build | local Docker daemon cannot start; CI Docker job exists but no remote yet |
| Source control | local git repository initialized; GitHub remote and credentials still missing |
| DPC registration | operating entity/TIN and DPC certificate not yet obtained; see `docs/DPC.md` |

## Decision

Detection (Phase 2) is **paused**. Do not start parsers, OCR or provider connections until the M0
gate in `docs/RUNBOOK.md` is completed on deployed infrastructure with real devices and email.

## Next actions

1. Push the local `main` branch to GitHub so CI can validate the Docker image.
2. Create the Render web service and worker from `render.yaml`; set the `sync: false` secrets.
3. Verify `dueradar.cloud` in Resend, add SPF/DKIM/DMARC and the inbound webhook.
4. Configure Neon Auth SMTP with Resend, trusted origins and production callbacks.
5. Point `app.dueradar.cloud` at Render and complete the M0 checklist on real devices.
6. Register with the DPC and publish the registration number before inviting real users; work through
   `docs/DPC.md`.
