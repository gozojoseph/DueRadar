# DNS records for dueradar.cloud

Domain status at 2026-11-16: **available, not registered**. Register it before adding records.
Resend domain id `aa7505e4-ae5c-4ef0-8702-3fdb768b908a`, region `eu-west-1`.

## Resend sending records

| Type | Name | Priority | Value | Purpose |
| --- | --- | --- | --- | --- |
| TXT | `resend._domainkey` | — | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCz5XTJduulefZaswaoiEVNrLew4VnMQxpmJjM5Xr84y4sziJLnVkwpwmKxKT0J97dC4yFSJ1oSRtQ1zp+QPhnnxhwDl34rBEUlv/DPPfKOpMgVKrio+aQlS9YnVsuTqOW51NCtlMbpX6sNsoQjQjxvB8uKKSwAF38MQVqMYWWcaQIDAQAB` | DKIM signing |
| MX | `send` | 10 | `feedback-smtp.eu-west-1.amazonses.com` | SPF bounce/return path |
| TXT | `send` | — | `v=spf1 include:amazonses.com ~all` | SPF for the sending subdomain |
| CNAME | `rsend` | — | `send.forge.rmta.net` | Resend click/open tracking |

## Records to add once the app host exists

| Type | Name | Priority | Value | Purpose |
| --- | --- | --- | --- | --- |
| CNAME | `app` | — | Render target hostname | Production PWA/API |
| CNAME | `staging` | — | Render staging target | Optional staging host |
| TXT | `_dmarc` | — | `v=DMARC1; p=none; rua=mailto:dmarc@dueradar.cloud` | Start DMARC in monitor mode |
| MX | `in` | 10 | Resend inbound hostname | Inbound catch-all, after receiving is enabled |
| TXT | `in` | — | Resend inbound SPF value | Inbound SPF, after receiving is enabled |

## Verification

After adding the Resend records, verify the domain in Resend (`POST /domains/{id}/verify`) and
confirm `status` becomes `verified`. Then send a real test to a mailbox outside the account before
switching Neon Auth SMTP from the shared provider to `smtp.resend.com:465` (user `resend`, password
is the Resend API key).

Do not point `app.dueradar.cloud` at Render until TLS and `APP_ORIGIN` match exactly and the origin
is trusted in Neon Auth.
