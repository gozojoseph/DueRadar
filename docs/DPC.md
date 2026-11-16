# Ghana Data Protection Commission launch pack

Status: **not registered — public launch gate**
Last reviewed: 2026-11-16
Owner: DueRadar operator (to be named)
Scope: DueRadar Phase 1 (accounts, subscription/bill/trial tracking, reminders)

This is an operational preparation pack, not legal advice. Confirm the entity category, fee and
wording with the Data Protection Commission (DPC) before filing.

## 1. Why registration is a launch gate

The DPC states that a data controller must register **before** processing personal data:

- Section 27(1) of the Data Protection Act, 2012 (Act 843): a data controller who intends to process
  personal data shall register with the Commission.
- Section 53: a data controller that has not registered shall not process personal data.
- Section 56: processing without registration is an offence, with a fine of up to 250 penalty units
  and/or up to two years' imprisonment.
- Sections 46–47 establish the Data Protection Register.

The DPC also requires foreign companies processing personal data in Ghana to register. DueRadar is
marketed to Ghanaian users and uses `Africa/Accra`/GHS defaults, so it is in scope even though the
servers are in the UK and EU.

**Rule until the certificate is issued:** do not invite real users to the production host. Internal
acceptance may use synthetic test accounts only. Do not load real statements, real email or real
payment records into any environment.

## 2. Prerequisites to have ready

The DPC portal asks for business details, so the operating entity must exist on paper first.

| Item | Status | Notes |
| --- | --- | --- |
| Operating entity decision (sole proprietor vs company) | **Open** | Determines the name on the certificate and who signs the filing |
| Registrar General's Department registration | **Open** | Certificate of incorporation or business name registration |
| Corporate TIN | **Open** | Required for the DPC application; foreign entities are told to obtain one |
| Registered address in Ghana | **Open** | Use a real address where legal notices can be received |
| Contact email and phone | Partly ready | `support@dueradar.cloud`; add a monitored phone number |
| Data Protection Supervisor (DPS) | **Decision** | Optional under s.58 ("may appoint"); if appointed, must be certified/qualified |
| Privacy notice published | Done | `/privacy`, cites Act 843, rights, retention and subprocessors |
| Self-service access/export/deletion | Done | JSON/CSV export and immediate account deletion |

Fees published by the DPC in the 2026 schedule (confirm before paying):

| Category | Fee (GHS) |
| --- | --- |
| Specialised industries | 5,000.00 |
| Large entities | 2,340.00 |
| Medium entities | 1,170.00 |
| Small businesses and startups | 156.00 |

DueRadar should file as a small business/startup unless the DPC classifies it otherwise. Budget for
the renewal fee and any compliance-report costs as recurring, not one-off.

## 3. Filing answers

These map to the information the DPC lists as required for registration.

### a. Business details

- Legal name: `[OPERATING ENTITY]`
- Trading name: DueRadar
- Registered address: `[REGISTERED ADDRESS, GHANA]`
- Website: `https://app.dueradar.cloud` (after launch)
- Contact: `support@dueradar.cloud`, `[PHONE]`
- Representative in Ghana (if the applicant is an external company): `[NAME, ADDRESS, PHONE]`

### b. Personal data to be processed

| Data category | Examples | Source |
| --- | --- | --- |
| Account and identity | Name, email address, auth user ID, email-verification status, password hash held by Neon Auth | User sign-up; authentication provider |
| Tracking records | Bill/subscription/trial name, vendor, amount, currency, billing cycle, due date, trial end, category, payment-method label, notes, optional link | User entry |
| Payment log | Date, amount, method label, optional reference for payments the user says they made | User entry |
| Preferences | Time zone, reminder time, quiet hours, week start, email/push choices, locale | User settings |
| Device and delivery | Push endpoint, `p256dh` and auth keys, limited user-agent/platform, notification content/read state, delivery attempts | Browser push subscription; worker |
| Security and audit | Action, entity type/ID, IP address, user agent, metadata, timestamps; webhook dedupe IDs | API; email/push providers |
| Support correspondence | Messages the user sends to support | User contact |

No special-category data is requested. Free-text notes are user-controlled; users are told not to
enter payment credentials or sensitive data, and the product has no fields for card numbers,
CVVs, PINs, bank credentials or account numbers.

### c. Categories of data subjects

- Adults who create a DueRadar account, primarily in Ghana and the Ghanaian diaspora.
- No employee, applicant, child or marketing-prospect data is processed in Phase 1.
- No data is purchased or scraped.

### d. Purpose of processing

1. Create and verify accounts, authenticate users and secure sessions.
2. Store the records the user enters and project future due dates from the schedule.
3. Send the reminders the user requested by email, browser push and in-app notification.
4. Show users their own data and enforce ownership on every read and write.
5. Provide support and investigate abuse or security incidents.
6. Meet legal obligations, including lawful requests and a minimal deletion record.

No sale of personal data, no advertising profiles, no use of tracking data to train third-party
models.

### e. Recipients and processors

| Recipient | Role | Location | Data |
| --- | --- | --- | --- |
| Neon Inc. | Database and managed authentication | United Kingdom (`aws-eu-west-2`, London) | All account and tracking data, auth credentials |
| Render Services, Inc. | Application and worker hosting | Frankfurt, Germany | Data in transit and process memory; application logs |
| Resend, Inc. | Transactional email | EU sending region (`eu-west-1`); group operations may include the US | Email address, verification and reminder content |
| Apple, Google, Mozilla push services | Deliver browser notifications | United States and global edge | Push endpoint, encrypted payload |
| Professional advisers / lawful authorities | Legal and regulatory | As required | Minimum necessary |

No analytics, advertising or data-broker recipients are used in Phase 1.

### f. International transfers

Personal data is transferred to the United Kingdom (database/auth), Germany/EU (hosting) and the
United States (email and push providers, and possibly support tooling). Safeguards to record:

- Provider data-processing agreements and, where required, standard contractual clauses.
- Region selection (Neon London, Render Frankfurt, Resend `eu-west-1`).
- Encryption in transit; provider encryption at rest.
- Data minimisation: no payment credentials, no inbox access, no contact upload.
- A transfer assessment that records why each provider is necessary.

**Open action:** obtain and file the current DPA/SCC terms for Neon, Render and Resend, and confirm
where support email is stored.

### g. Security measures

Implemented in Phase 1:

- TLS in transit; HSTS enabled when `APP_ORIGIN` is HTTPS; Helmet CSP and frame protections.
- Rate limits on auth proxy, account deletion, device registration and webhooks.
- Email verification required before an account is usable.
- Passwords salted and hashed by Neon Auth; plain-text passwords are never stored or logged.
- Short-lived EdDSA JWTs verified against the branch JWKS; HttpOnly, SameSite first-party cookies;
  `Secure` cookies in production.
- Sign-out and password reset revoke sessions.
- Ownership filtering by user ID on every read and write; guessed IDs return 404.
- Account deletion is transactional across app and auth tables, clears the session cache and expires
  all managed and self-hosted auth cookies. Regression tests cover deleted-account bearer rejection.
- Audit events for security-relevant actions, retention-limited to 12 months (deletion rows kept
  without user ID, email or tracking content).
- Secrets only in gitignored `.env.local` or Render environment storage; `.env.local` is excluded from
  git and the Docker build context.
- Separate staging/production Neon branches and credentials; migrations run under an advisory lock.
- Schema validation on API inputs; parameterised queries through Drizzle.

Known gaps to disclose and close:

- No two-factor authentication yet (disclosed on `/security`).
- No independent penetration test or SOC 2/ISO 27001 certification.
- No dedicated data-protection officer; a DPS appointment is a business decision.
- Provider DPAs/SCCs not yet filed.
- No breach-response drill completed.
- Hosting/provider access logs are outside DueRadar's own retention job; confirm provider retention.

## 4. Record of processing activities (ROPA)

Keep this table current; it is the basis for the filing and for renewal.

| Processing activity | Data subjects | Data | Purpose | Recipients | Retention |
| --- | --- | --- | --- | --- | --- |
| Account creation and sign-in | Users | Name, email, auth ID, verification, password hash | Authenticate and secure access | Neon, Render | Until account deletion |
| Subscription/bill/trial tracking | Users | Record fields, amounts, dates, notes | Provide the core service | Neon, Render | Until record/account deletion |
| Payment logging | Users | Date, amount, method label, reference | Let users confirm what they paid | Neon, Render | Until record/account deletion |
| Reminder delivery | Users | Email, push endpoint/keys, notification content, delivery attempts | Send requested reminders | Neon, Render, Resend, push services | Delivery attempts 12 months |
| Device management | Users | Endpoint, keys, user agent, platform | Deliver push and let users recognise devices | Neon, Render, push services | Until device/account deletion |
| Security and audit | Users, visitors | Action, entity, IP, user agent, timestamps | Detect abuse, investigate incidents, meet legal duties | Neon, Render | 12 months (deletion row until purged) |
| Import processing (Phase 2) | Users | Raw statement/email text | Extract candidate records | Neon, Render; LLM only if enabled | Raw text ≤72 hours; extracted suggestions until resolved/deleted |
| Support | Users who contact support | Message, email, attachments the user sends | Resolve the request | Support mailbox provider | Until resolved + 12 months, then delete |

## 5. Retention schedule (verified against code)

`packages/scheduling/src/maintenance.ts` enforces:

| Data | Retention | Mechanism |
| --- | --- | --- |
| Raw imported text | 72 hours | `imports.raw_text` nulled, status `expired` |
| Webhook dedupe records | 30 days | Deleted by maintenance |
| Delivery attempts | 12 months | Deleted by maintenance |
| Audit events | 12 months | Deleted by maintenance, including `account.deleted` rows |
| Account and tracking data | Until user deletes | Immediate transactional deletion |
| In-app notifications | Until account deletion | Removed transactionally with the user |
| Deletion audit row | 12 months, with the audit log | No user ID, email or tracking content; metadata is reason + `hadEmail` |
| Database backups | Provider restore window | Confirm the configured Neon window and record it here: `[WINDOW]` |

The privacy notice promises "up to 12 months" for delivery attempts and audit events, and says the
deletion record expires with the audit log. `maintenance.ts` now enforces all three. **Open action:**
confirm the first production maintenance cycle logs `purgedDeliveryAttempts` and `purgedAudit` as
expected when rows age out.

## 6. Data subject request procedure

Statutory deadline: respond promptly and in any event within **40 days** of receipt (s.35(5)).
Record every request, even if refused.

1. **Receive** at `support@dueradar.cloud`. Log date received, requester, right exercised, and due
   date (received + 40 days).
2. **Verify identity.** Respond only to the verified account email, or require proof of control of
   that mailbox. Never disclose data to a third party without written authority.
3. **Access/copy.** Use Settings → export (JSON/CSV). Send the export through a link the requester
   can access, not as an unencrypted attachment if it contains tracking details.
4. **Correction.** Fix records in the product; if the data is contested and cannot be corrected,
   record the dispute.
5. **Deletion.** Use Account → delete. Confirm the 204 and that the old session fails. Explain the
   minimal deletion audit row and backup window.
6. **Restriction/objection.** Phase 1 sends no marketing. For other processing, stop the relevant
   activity and record the restriction.
7. **Refusal.** Give the reason and the right to complain to the DPC. Do not charge a fee without
   checking the Act and DPC guidance.
8. **Close** by the due date and retain the request log (not the disclosed data) for accountability.

## 7. Personal data breach procedure

Ghana's Act 843 does not set a 72-hour deadline; the DPC's guidance is to notify **as soon as
possible**. Use a 24-hour internal escalation target so notification is not delayed.

1. **Detect and record:** open a breach log with time, reporter, systems, data categories and
   approximate number of users.
2. **Contain:** revoke keys/sessions, disable the affected endpoint, rotate credentials, preserve
   evidence. Do not delete logs needed for the investigation.
3. **Assess:** confidentiality, integrity and availability impact; whether tracking data, account
   data or credentials were exposed; risk of harm (fraud, identification, distress).
4. **Notify the DPC:** `info@dpc.gov.gh` / `+233 25 630 1533` / registration line `+233 25 630 1533`.
   Include what happened, when, data and users affected, likely consequences, and containment.
5. **Notify affected users** without undue delay if there is a risk of harm; give clear steps
   (password reset, session revocation, phishing warning).
6. **Remediate:** fix the cause, add a regression test, update the DPIA/ROPA, and record the closure.
7. **Review:** update this pack and the runbook; consider whether the DPC requires a follow-up report.

Contact list (verify before launch):

- DPC general: `info@dpc.gov.gh`, `+233 25 630 1533`
- DPC support: `support@dpc.gov.gh`
- DPC WhatsApp: `0506177975`
- DueRadar incident owner: `[NAME, PHONE, BACKUP CONTACT]`

## 8. DPIA screening

Phase 1 processes ordinary account and financial-tracking data at modest scale, with no special
categories, no automated decisions with legal effect, no systematic monitoring and no sale of data.
A full DPIA is not obviously mandatory, but complete a short screening now and a full DPIA **before**
Phase 2 detection ships.

Phase 2 changes the risk profile materially:

- Ingested statements and emails can contain transaction histories and third-party data.
- OCR runs on-device in the planned design, but extracted text still reaches the server.
- An optional LLM fallback would send redacted text to a processor.
- Provider connections (Gmail, banks) add OAuth tokens and broader scopes.

Reassess before enabling any of those, and do not enable Gmail until Google verification/CASA is
complete.

## 9. Processor and transfer register

| Provider | Service | Region | DPA/SCC status | Owner | Review |
| --- | --- | --- | --- | --- | --- |
| Neon Inc. | Postgres, Neon Auth | UK London | `[VERIFY + FILE]` | `[NAME]` | Annual |
| Render Services, Inc. | Web + worker hosting | Frankfurt, DE | `[VERIFY + FILE]` | `[NAME]` | Annual |
| Resend, Inc. | Transactional email | EU `eu-west-1` | `[VERIFY + FILE]` | `[NAME]` | Annual |
| Apple / Google / Mozilla | Browser push delivery | Global/US | Standard service terms | `[NAME]` | Annual |

Do not add a processor (analytics, support desk, LLM, error tracking) without updating this table,
the privacy notice and the transfer assessment first.

## 10. Launch checklist

| # | Task | Status |
| --- | --- | --- |
| 1 | Choose operating entity; obtain RGD certificate and TIN | Open |
| 2 | Create DPC portal account at `https://app.dpc.gov.gh/` | Open |
| 3 | File registration with the answers in section 3 | Open |
| 4 | Pay the applicable fee and keep the receipt | Open |
| 5 | Receive certificate and registration number | Open |
| 6 | Publish the registration number on `/privacy` | Open (placeholder exists) |
| 7 | Decide on a Data Protection Supervisor; record the decision | Open |
| 8 | File Neon, Render and Resend DPAs/SCCs | Open |
| 9 | Confirm Neon backup window and record it in section 5 | Open |
| 10 | Confirm delivery-attempt and deletion-audit purges run in production | Done in code; verify first cycle |
| 11 | Name the incident owner and backup contact | Open |
| 12 | Run a tabletop breach drill and record lessons | Open |
| 13 | Complete DPIA screening sign-off | Open |
| 14 | Add annual renewal reminder (3 months before expiry) | Open |
| 15 | Re-check the fee schedule and Act 843 guidance before filing | Open |

Public launch remains **no-go** until items 1–6 are complete.

## 11. Renewal

- Registration must be renewed; the DPC portal opens renewal three months before expiry and up to
  seven days after.
- Renewal requires a compliance report, updated entity/data details and the renewal fee.
- Calendar the expiry date, the renewal window and the compliance-report preparation date.
- Keep the certificate, receipt, ROPA, DPIA screening, breach log and request log together.

## 12. Sources

- DPC registration page: `https://dpc.gov.gh/registration/` (accessed 2026-11-16)
- DPC help and FAQs: `https://dpc.gov.gh/help-faqs/` (accessed 2026-11-16)
- DPC fees schedule (2026): `https://dpc.gov.gh/wp-content/uploads/2026/02/DPC-NEW-FEES.pdf`
- Data Protection Act, 2012 (Act 843), especially ss. 27, 32–35, 43, 46–47, 53, 56, 58
- DueRadar privacy notice: `apps/web/src/pages/Legal.tsx` (`/privacy`)
- DueRadar retention implementation: `packages/scheduling/src/maintenance.ts`
- DueRadar deletion implementation: `apps/api/src/routes/account.ts`

Re-verify all external links, fees and section numbers at filing time; the DPC updated its fee
schedule in 2026.
