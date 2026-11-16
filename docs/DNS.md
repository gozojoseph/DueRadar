# DNS records for dueradar.cloud

Status 2026-11-16: **sending is live.** Resend domain `aa7505e4-ae5c-4ef0-8702-3fdb768b908a`
(region `eu-west-1`) reports sending verified with a real test send (`onboarding@dueradar.cloud` →
Gmail, HTTP 200). Receiving is **enabled**; its apex MX record is still pending.

- **Registrar:** Namecheap. Nameservers delegated to Cloudflare via Namecheap → domain →
  Nameservers → **Custom DNS** = `elisa.ns.cloudflare.com` + `robert.ns.cloudflare.com`
  (delegation confirmed live). Namecheap "Custom DNS" holds nameserver hostnames **only** —
  records are never entered there.
- **Zone:** Cloudflare (free plan). Manage all records in Cloudflare → DNS → Records.

## Cloudflare entry notes

- Enter only the label in **Name** (Cloudflare appends `.dueradar.cloud` itself).
- Everything mail-related stays **DNS only** (grey cloud). Orange-cloud proxying is never used for
  MX/TXT and would break inbound mail and webhook endpoints.
- Resend auto-verifies; a manual `POST /domains/{id}/verify` can be forced if a record was just
  re-added.

## Sending records — verified 2026-11-16

| Type | Name | Priority | Value | Purpose |
| --- | --- | --- | --- | --- |
| TXT | `resend._domainkey` | — | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCz5XTJduulefZaswaoiEVNrLew4VnMQxpmJjM5Xr84y4sziJLnVkwpwmKxKT0J97dC4yFSJ1oSRtQ1zp+QPhnnxhwDl34rBEUlv/DPPfKOpMgVKrio+aQlS9YnVsuTqOW51NCtlMbpX6sNsoQjQjxvB8uKKSwAF38MQVqMYWWcaQIDAQAB` | DKIM signing |
| MX | `send` | 10 | `feedback-smtp.eu-west-1.amazonses.com` | SPF bounce/return path |
| TXT | `send` | — | `v=spf1 include:amazonses.com ~all` | SPF for the sending subdomain |
| CNAME | `rsend` | — | `send.forge.rmta.net` | Resend tracking |
| TXT | `_dmarc` | — | `v=DMARC1; p=none; rua=mailto:dmarc@dueradar.cloud` | DMARC monitor mode |

## Receiving — apex MX, no subdomain

Enabling Receiving in the Resend dashboard flipped `capabilities.receiving` to `enabled` and issued
exactly one record — MX on the apex (Resend does not offer a subdomain receiving record):

| Type | Name | Priority | Value | Purpose |
| --- | --- | --- | --- | --- |
| MX | `@` (apex) | **9** | `receive-euw1.forge.rmta.net` | Inbound catch-all for receiving (verified 2026-11-16) |

Consequence: the receiving domain is `dueradar.cloud` itself, so `INBOUND_EMAIL_DOMAIN=dueradar.cloud`
and every user's forwarding alias is `dr-<random>@dueradar.cloud`. The earlier `in.dueradar.cloud`
plan is dropped. Sending is unaffected (its MX/SPF live on the `send` subdomain), and MX records
cannot be proxied, so no orange-cloud concern.

Known cleanup: the apex also serves leftover Namecheap Email-Forwarding MX rows
(`eforward1-5.registrar-servers.com`, prefs 10/15/20) that came across from Namecheap. They are
shadowed by Resend's priority-9 record but should be deleted unless Namecheap forwarding is
deliberately used for some address.

## Records still to add

| Type | Name | Priority | Value | Purpose |
| --- | --- | --- | --- | --- |
| CNAME | `app` | — | Render target hostname | Production PWA/API (only after TLS + `APP_ORIGIN` + Neon-Auth origin alignment — see warning below) |
| CNAME | `staging` | — | Render staging target | Optional staging host |

## Debugging DNS from this machine

Learned the hard way on 2026-11-16 — do not trust local DNS tooling here:

- **TXT queries time out from this network** (`Resolve-DnsName`/`nslookup`, UDP *and* TCP, against
  any server including `elisa.ns.cloudflare.com` directly and 8.8.8.8). MX/NS/SOA/CNAME work, so a
  missing TXT locally does **not** mean the record is missing globally.
- Use DoH instead — it returns the true public view:
  `Invoke-RestMethod "https://dns.google/resolve?name=<name>&type=TXT"` or
  `Invoke-RestMethod "https://cloudflare-dns.com/dns-query?name=<name>&type=TXT" -Headers @{accept="application/dns-json"}`.
- Windows negative-caches NXDOMAIN (Cloudflare negative TTL up to 1h) — `ipconfig /flushdns`
  before re-checking anything that was recently added.

## Verification history

- 2026-11-16: DNS delegated Namecheap → Cloudflare (`elisa`/`robert`).
- 2026-11-16: All four Resend sending records verified (`status: verified`,
  `capabilities.sending: enabled`, `receiving: disabled`).
- 2026-11-16: Test send `POST https://api.resend.com/emails` → **HTTP 200**, id
  `01a1e4f1-8aeb-7927-a025-b67f27d909af`, from `DueRadar <onboarding@dueradar.cloud>` to
  `gozojoseph122@gmail.com`; landed in the real inbox (not spam).
- 2026-11-16: Receiving enabled in the Resend dashboard (`capabilities.receiving: enabled`); domain
  moved to `partially_verified` pending the apex MX record (`receive-euw1.forge.rmta.net`, priority 9).
- Next: switch Neon Auth SMTP to `smtp.resend.com:465` (user `resend`, password = Resend API key)
  per `RUNBOOK.md` §7 and `PHASE1-CHECKPOINT.md` step 4, then send a real signup email.

Do not point `app.dueradar.cloud` at Render until TLS and `APP_ORIGIN` match exactly and the origin
is trusted in Neon Auth.
