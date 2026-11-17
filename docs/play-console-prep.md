# DueRadar — Google Play publication prep

Package name: `cloud.dueradar.app` · Support email: `support@dueradar.cloud`
Domain (single host, TWA): `app.dueradar.cloud`

## 0. Account + testing gate (start first — it is the long pole)

- Personal Play Console accounts created after Nov 13 2023 must run a **closed test with at
  least 12 testers opted in for 14 consecutive days** before the production-access application
  (review ≤ 7 days). Realistic timeline: ~1–2 days of build work + ~3–4 weeks calendar.
- Registration: $25 one-time, identity + device verification.
- Closed testers: use a Google Group (e.g. `dueradar-testers`) as the allowlist; 12+ real
  people must *opt in* via the opt-in URL and keep the app installed.
- Internal testing (up to 100 emails) comes first and does not count toward the 14 days.

## 1. Store listing

| Field | Value |
| --- | --- |
| App name | DueRadar |
| Short description (≤80) | Track bills, subscriptions and free trials. Reminders before every due date. |
| Category | Finance (fallback: Productivity) |
| Tags | bills, budget, reminders, subscriptions |
| Contact email | support@dueradar.cloud |
| Website | https://app.dueradar.cloud |
| Privacy policy | https://app.dueradar.cloud/privacy |

**Do not mention DueRadar Plus, prices, or Paystack anywhere in the listing.** Describe the
free app: track up to five items, due-date reminders, Gmail/email import preview, calendar,
push notifications.

Full description draft (≤4000 chars):

> DueRadar helps you stay on top of every bill, subscription, prepaid plan and free trial in
> Ghana — in one calm place.
>
> - Track what you owe and when it is due, sorted by what is due next
> - Get reminders before every due date, by push notification and email
> - Import from pasted text, forwarded emails, CSV or a screenshot
> - See a monthly calendar of upcoming payments
> - Works offline, installs to your home screen, GHS by default
>
> Free to use for your first five tracked items. Built for MTN, Vodafone, ECG, GoTV, DSTV,
> Netflix, Spotify and every other recurring payment.

### Assets

- App icon 512×512 (≤1 MB): reuse `apps/web/public/icons/icon-512.png`
- Feature graphic 1024×500: **TODO** (brand banner — generate or design)
- Phone screenshots ≥2 (16:9 or 9:16, e.g. 1080×1920): capture Dashboard + Occurrences
  from the PWA

## 2. App content declarations

- Ads: **No**
- In-app purchases: **No** (the Play build hides the web checkout UI — enforced by the
  `?src=play` flag in `apps/web/src/lib/android.ts`)
- News app: No · Government app: No · Health: No · COVID-19: No
- Child-directed / target audience: 18+ (a bills tracker for adults; do not opt into Families)
- Financial features: **No financial products** (a tracker is not lending/banking/crypto)
- Data deletion: in-app at Settings → Account, plus URL
  `https://app.dueradar.cloud/settings/account`

## 3. Data safety form

Answer "Yes" to collecting data. Declared types (all collected, **not shared** with third
parties; encrypted in transit; users can request deletion):

| Category | Types | Why |
| --- | --- | --- |
| Personal info | Name, Email address, User IDs | Account, support, billing reference |
| Financial info | Other financial info (bills/amounts/due dates), Purchase history (Plus status) | Core feature; Paystack never shares card data with us |
| Messages | Emails (forwarded/connected Gmail-derived due info) | Detection feature |
| App activity | App interactions | Basic analytics-free; only if we log |
| Device or other IDs | Device or other IDs (push subscription endpoints) | Push notifications |

Encryption in transit: **Yes** · Deletion mechanism: **Yes** (in-app + URL).

## 4. Reviewer access (app access)

Provide one working test account in "App access" — reviewers must be able to sign in.
**Blocked on fixing the production sign-in password first** (401 thread). Create a dedicated
reviewer account rather than handing out personal credentials.

## 5. Release flow

1. **Internal test** → upload `apps/android/app-release-bundle.aab` → Play App Signing gets
   enabled on first upload → copy the **App signing key certificate SHA-256** from
   Release → Setup → App signing → regenerate `assetlinks.json` with both fingerprints
   (upload key + app signing key) → deploy → the installed TWA must open without a URL bar.
2. **Closed test** → create the track, attach the Google Group, promote the release, recruit
   12+ opted-in testers → 14-day clock starts.
3. **Production access application** → submit declarations → wait for approval (≤7 days).
4. **Production** → promote the closed-test release; every later upload needs a bumped
   `versionCode` in `twa-manifest.json` + `bubblewrap build`.

## 6. Technical state

- [x] Web gates for the Play build (`?src=play` → hide web checkout UI)
- [x] `/.well-known/assetlinks.json` route (no-cache, reads `apps/web/public/.well-known/`)
- [x] TWA project generated (`apps/android`, Bubblewrap 1.27, JDK 17 + SDK cached in
  `C:\Users\gozoj\.bubblewrap\config.json`)
- [x] Upload keystore created: `apps\android\android.keystore`, alias `android`, valid to 2081.
  Backup copy: `C:\Users\gozoj\Desktop\dueradar-keystore-backup\android.keystore`.
  **Still TODO: password + file into durable storage (password manager / cloud).**
- [x] Upload-key SHA-256 (keystore password = key password):
  `E7:22:D4:5F:0B:5D:75:92:4C:43:E1:B7:7D:0F:D7:7B:E2:F6:F8:E0:B8:DC:0E:08:BF:0F:9E:4F:A5:F2:39:89`
- [x] `assetlinks.json` written with the upload-key fingerprint and deployed
  (verified live at `https://app.dueradar.cloud/.well-known/assetlinks.json`)
- [ ] AAB built (`apps/android/app-release-bundle.aab`)
- [ ] Play App Signing cert SHA-256 appended after first upload

## 7. Rebuilding the app

From `apps/android`: `bubblewrap build` (prompts for the keystore and key passwords;
JDK/SDK/Gradle are cached after the first run). Every store update needs a bumped
`appVersionCode` in `twa-manifest.json` first. `enableNotifications` is already `true`
(Android 13+ POST_NOTIFICATIONS). Manifest shortcuts are skipped until the web manifest
defines per-shortcut icons.
