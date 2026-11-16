import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ExternalLink, Mail, ShieldCheck } from "lucide-react";
import { AppShell } from "../components/AppShell";
import { Wordmark } from "../components/Logo";
import { Badge } from "../components/ui";
import { useAuth } from "../lib/session";

const UPDATED = "15 November 2026";
const SUPPORT = "support@dueradar.cloud";

function LegalShell({ children }: { children: ReactNode }) {
  const { status } = useAuth();

  if (status === "authenticated") return <AppShell>{children}</AppShell>;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line/70 bg-paper/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-4 px-4 py-3.5 sm:px-6">
          <Link to="/" aria-label="DueRadar home">
            <Wordmark />
          </Link>
          <nav className="ml-auto flex items-center gap-4 text-sm font-medium text-muted">
            <Link to="/privacy" className="hover:text-ink">
              Privacy
            </Link>
            <Link to="/terms" className="hover:text-ink">
              Terms
            </Link>
            <Link to="/security" className="hover:text-ink">
              Security
            </Link>
            <Link
              to="/sign-in"
              className="rounded-full bg-brand-800 px-3.5 py-2 text-xs font-semibold text-white hover:bg-brand-900"
            >
              Sign in
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6 sm:py-14">{children}</main>
      <footer className="border-t border-line/70 py-6 text-center text-xs text-muted">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-x-4 gap-y-2 px-4">
          <span>DueRadar · Accra, Ghana</span>
          <Link to="/privacy" className="hover:text-ink">
            Privacy
          </Link>
          <Link to="/terms" className="hover:text-ink">
            Terms
          </Link>
          <Link to="/security" className="hover:text-ink">
            Security
          </Link>
          <a href={`mailto:${SUPPORT}`} className="hover:text-ink">
            {SUPPORT}
          </a>
        </div>
      </footer>
    </div>
  );
}

function LegalHeader({
  eyebrow,
  title,
  intro,
}: {
  eyebrow: string;
  title: string;
  intro: string;
}) {
  return (
    <header className="mb-8">
      <Link
        to="/"
        className="mb-5 inline-flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to DueRadar
      </Link>
      <p className="text-[0.7rem] font-bold uppercase tracking-[0.16em] text-brand-600">{eyebrow}</p>
      <h1 className="mt-2 font-display text-[2rem] leading-tight font-semibold tracking-[-0.03em] text-ink text-balance sm:text-[2.4rem]">
        {title}
      </h1>
      <p className="mt-3 text-[0.95rem] leading-relaxed text-ink-soft">{intro}</p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Badge tone="plain">Last updated {UPDATED}</Badge>
        <Badge tone="brand">
          <ShieldCheck className="h-3 w-3" />
          Ghana · Act 843
        </Badge>
      </div>
    </header>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id?: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-line/80 py-6 first:border-t-0 first:pt-0">
      <h2 className="font-display text-xl font-semibold tracking-[-0.015em] text-ink">{title}</h2>
      <div className="mt-3 space-y-3 text-[0.925rem] leading-relaxed text-ink-soft">{children}</div>
    </section>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function RetentionRow({ what, how }: { what: string; how: string }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-line/60 py-2.5 last:border-b-0 sm:flex-row sm:gap-4">
      <dt className="w-full shrink-0 font-medium text-ink sm:w-48">{what}</dt>
      <dd className="min-w-0">{how}</dd>
    </div>
  );
}

/* --------------------------------- Privacy --------------------------------- */

export function PrivacyPage() {
  return (
    <LegalShell>
      <LegalHeader
        eyebrow="Privacy notice"
        title="What DueRadar keeps, why, and for how long."
        intro="DueRadar tracks the dates and amounts you enter. If you choose to connect Gmail, it uses read-only access to scan billing-related messages you request. DueRadar does not connect to your bank or store card numbers."
      />

      <Section title="Who is responsible">
        <p>
          DueRadar is a subscription, bill and free-trial tracker operated from Accra, Ghana. For the
          personal data described here, DueRadar is the data controller. Questions, requests and
          complaints can go to{" "}
          <a href={`mailto:${SUPPORT}`} className="font-semibold text-brand-700 hover:underline">
            {SUPPORT}
          </a>
          .
        </p>
        <p>
          We process personal data under the Data Protection Act, 2012 (Act 843). Where the Act
          requires registration of a data controller, we will publish our registration details here
          once issued.
        </p>
      </Section>

      <Section title="What we collect">
        <Bullets
          items={[
            "Account data: your name, email address, sign-in identifiers, verification status and password hash. Passwords are salted and hashed by our authentication provider; we never see them in plain text.",
            "Tracking data you enter: names, vendors, amounts, currencies, billing cycles, due dates, trial end dates, categories, payment-method labels, notes and optional links.",
            "Payment log entries: the date, amount, method label and optional reference you record when you mark something paid. These are records of payments you say you made, not payment instructions.",
            "Gmail connection data, only if you connect it: your Gmail address, encrypted OAuth tokens, scan cursor, and the message identifiers and billing details needed to create import suggestions.",
            "Gmail message text is redacted before storage and erased within 72 hours. Extracted suggestions and message metadata remain until you delete them or your account.",
            "DueRadar Plus billing data: plan and term, transaction reference, amount, currency, payment status and the email used at hosted checkout. Paystack processes the purchase; we do not receive or store card details or mobile-money PINs.",
            "DueRadar Plus billing data: plan and term, transaction reference, amount, currency, payment status and the email used at hosted checkout. Paystack processes the purchase; we do not receive or store card details or mobile-money PINs.",
            "Reminder preferences: your time zone, preferred reminder time, quiet hours, week start, email and push choices.",
            "Device data: a push endpoint and encryption keys for each browser or phone you enable, plus limited user-agent information so you can recognise the device.",
            "Delivery data: reminder jobs, delivery attempts, in-app notifications and read state.",
            "Security data: account suspension status and its current reason, plus audit events for administrative actions, exports and deletion with request metadata needed to operate the service.",
          ]}
        />
      </Section>

      <Section title="What we never ask for">
        <Bullets
          items={[
            "Full card numbers, CVVs, expiry dates or PINs.",
            "Mobile-money PINs or one-time payment codes.",
            "Bank passwords, bank connection credentials or account numbers.",
            "Gmail access unless you explicitly connect it. The optional Gmail integration requests read-only access; it does not send, delete, or change messages.",
          ]}
        />
        <p>
          DueRadar does not move money or cancel subscriptions with providers. Optional Plus
          purchases are one-time payments through Paystack hosted checkout; we do not initiate
          automatic renewals or store payment credentials. Refund requests are reviewed case by case
          under applicable law; contact support.
        </p>
      </Section>

      <Section title="Why we use it">
        <Bullets
          items={[
            "To create your account, verify your email, sign you in and keep your session secure.",
            "To store the records you add and calculate projected due dates from the schedule you entered.",
            "To send the reminders you asked for by email, push and in-app notification, while respecting quiet hours.",
            "If you connect Gmail, to search recent billing-related messages and create import suggestions when you choose to scan.",
            "To confirm DueRadar Plus purchases, grant the purchased access term, and prevent duplicate payment processing.",
            "To confirm DueRadar Plus purchases, grant the purchased access term, and prevent duplicate payment processing.",
            "To show your own data back to you and to enforce ownership on every read and write.",
            "To provide support when you contact us, and to investigate abuse or security incidents.",
            "Authorized administrators may review account identity, plan and billing status, and suspension reasons; they cannot view your tracked-item details in the admin dashboard.",
            "To meet legal obligations, including responding to lawful requests and maintaining deletion records.",
          ]}
        />
        <p>
          We do not sell personal data, build advertising profiles, or use your tracking data to train
          third-party models.
        </p>
      </Section>

      <Section title="Who we share it with">
        <p>
          We use a small set of service providers that process data on our instructions. Each is bound
          by contract to use it only for providing their service:
        </p>
        <Bullets
          items={[
            "Neon (database and managed authentication) for storage and sign-in. Our primary database region is London, United Kingdom.",
            "Render (application hosting) for the web service and background worker. Our development environment runs in Frankfurt, Germany.",
            "Resend (transactional email) for verification codes, reminder emails and account notices.",
            "Google (OAuth and Gmail API) when you connect Gmail. Google grants the requested Gmail read-only scope; DueRadar scans matching billing messages only when you start a scan.",
            "Paystack (hosted checkout and payment verification) for DueRadar Plus purchases. Paystack receives the email, amount, currency and transaction reference needed to process the payment; card and mobile-money credentials are entered directly with Paystack.",
            "Paystack (hosted checkout and payment verification) for DueRadar Plus purchases. Paystack receives the email, amount, currency and transaction reference needed to process the payment; card and mobile-money credentials are entered directly with Paystack.",
            "Browser push services operated by Apple, Google and Mozilla for delivering notifications to devices you register.",
          ]}
        />
        <p>
          We may also disclose data if required by law, to protect the rights and safety of users, or
          as part of a merger or acquisition where the successor remains bound by this notice. We will
          tell you if that happens, unless the law prevents it.
        </p>
      </Section>

      <Section title="International transfers">
        <p>
          Our database is hosted in the United Kingdom and our application in the European Union, so
          data may be processed outside Ghana. Email and push delivery may involve providers in the
          United States. Paystack processing locations depend on the merchant account and payment
          method. We choose providers with appropriate contractual and technical safeguards, and we
          only transfer the minimum needed for the service.
        </p>
      </Section>

      <Section title="How long we keep it">
        <dl className="rounded-xl border border-line bg-surface/60 px-4 py-2">
          <RetentionRow
            what="Account and tracking data"
            how="Until you delete it or delete your account. Deletion is immediate."
          />
          <RetentionRow
            what="DueRadar Plus billing records"
            how="Until account deletion; only transaction metadata is stored, never card or mobile-money credentials."
          />
          <RetentionRow
            what="DueRadar Plus billing records"
            how="Until account deletion; only transaction metadata is stored, never card or mobile-money credentials."
          />
          <RetentionRow
            what="Raw imported statements or screenshots"
            how="At most 72 hours. Extracted text is erased automatically after processing."
          />
          <RetentionRow
            what="Gmail OAuth credentials"
            how="Encrypted by DueRadar and kept until you disconnect Gmail or delete your account. Disconnect clears the saved token and connection details; deleting your account does not guarantee Google-side authorization is revoked."
          />
          <RetentionRow
            what="Gmail message content"
            how="Redacted text is erased within 72 hours; extracted suggestions and message metadata remain until you delete them."
          />
          <RetentionRow
            what="Inbound email and webhook payloads"
            how="Up to 30 days for delivery troubleshooting, then purged."
          />
          <RetentionRow
            what="Delivery attempts and audit events"
            how="Up to 12 months, then purged. Audit events record actions, not your bill contents."
          />
          <RetentionRow
            what="Deletion audit record"
            how="One record confirming a deletion, with no user ID, email or tracking content. It expires with the audit log."
          />
          <RetentionRow
            what="Database backups"
            how="Short-lived backups are overwritten according to our database provider's retention window. They are not used to restore individual deleted accounts."
          />
        </dl>
      </Section>

      <Section title="Your rights">
        <p>Under Act 843 you can ask us to:</p>
        <Bullets
          items={[
            "Confirm whether we hold personal data about you and give you a copy.",
            "Correct data that is inaccurate or incomplete.",
            "Delete data we no longer have a lawful reason to keep.",
            "Stop or restrict certain processing, including marketing (we do not send marketing email).",
            "Explain how we process your data and who receives it.",
          ]}
        />
        <p>
          Most of this is built into the product: Settings has a JSON export, and the account page can
          delete everything immediately. For anything else, email {SUPPORT}. We respond within the
          period required by Ghanaian law. You may also complain to the Data Protection Commission of
          Ghana via{" "}
          <a
            href="https://dataprotection.org.gh"
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 font-semibold text-brand-700 hover:underline"
          >
            dataprotection.org.gh
            <ExternalLink className="h-3 w-3" />
          </a>
          .
        </p>
      </Section>

      <Section title="Cookies and local storage">
        <p>
          DueRadar uses a first-party session cookie to keep you signed in. It is HttpOnly, SameSite
          and Secure in production, and is served through our own domain so Safari's tracking
          prevention does not break sign-in. We also store small preferences, such as whether you
          dismissed the install prompt, in your browser's local storage.
        </p>
        <p>
          There are no advertising cookies, cross-site trackers, or third-party analytics pixels in
          the app.
        </p>
      </Section>

      <Section title="Children">
        <p>
          DueRadar is intended for adults managing their own bills. It is not directed at children
          under 18, and we do not knowingly collect their personal data. If you believe a child has
          created an account, contact us and we will remove it.
        </p>
      </Section>

      <Section title="Changes and contact">
        <p>
          If we change this notice in a way that affects your rights, we will announce it in the app
          or by email before it takes effect, and update the date at the top of this page.
        </p>
        <p className="flex items-center gap-2 font-medium text-ink">
          <Mail className="h-4 w-4 text-brand-700" />
          <a href={`mailto:${SUPPORT}`} className="text-brand-700 hover:underline">
            {SUPPORT}
          </a>
        </p>
      </Section>
    </LegalShell>
  );
}

/* ---------------------------------- Terms ---------------------------------- */

export function TermsPage() {
  return (
    <LegalShell>
      <LegalHeader
        eyebrow="Terms of use"
        title="The agreement for using DueRadar."
        intro="These terms explain what DueRadar does, what it does not do, and the responsibilities that come with an account. By using the service, you agree to them."
      />

      <Section title="1. The service">
        <p>
          DueRadar helps you record bills, subscriptions, prepaid plans, instalments and free trials,
          and sends reminders before dates you choose. It calculates projected future dates and
          amounts from the schedule you enter.
        </p>
        <p>
          DueRadar is not a bank, payment processor, lender, insurer, or financial adviser. It does
          not charge your card, move money, cancel a subscription, or guarantee that a provider will
          bill you on the date shown. Projections are estimates, clearly labelled as projections
          until you record a payment.
        </p>
      </Section>

      <Section title="2. Eligibility and your account">
        <Bullets
          items={[
            "You must be at least 18 years old and able to enter a binding contract.",
            "Use a real email address you control. We verify it before the account becomes usable.",
            "Keep your password private and tell us promptly if you believe someone else has access.",
            "You are responsible for activity under your account, including records added from your devices.",
            "One person should not use another person's account without their permission.",
          ]}
        />
      </Section>

      <Section title="3. Your content">
        <p>
          You keep ownership of the information you enter. You grant DueRadar a limited licence to
          store, process and display it solely to operate the service for you, including calculating
          schedules, sending reminders you enabled and producing your export.
        </p>
        <p>
          Do not enter content you have no right to use, or another person's personal data without
          their permission. We may remove content that violates these terms or the law.
        </p>
      </Section>

      <Section title="4. Acceptable use">
        <Bullets
          items={[
            "Do not attempt to access another user's data, probe the service for vulnerabilities without permission, or bypass ownership checks.",
            "Do not use DueRadar to send spam, harass anyone, or store unlawful material.",
            "Do not scrape, overload, reverse engineer or resell the service.",
            "Do not use automated means to create accounts or abuse verification and reminder emails.",
          ]}
        />
        <p>
          We may suspend or terminate an account that puts other users, the service or our providers
          at risk. Where it is safe and lawful to do so, we will explain why. While suspended, you
          can still export your data or delete your account.
        </p>
      </Section>

      <Section title="5. Reminders and availability">
        <p>
          Reminders depend on email, push services, your device settings, network conditions and the
          accuracy of the dates you enter. Delivery can be delayed or blocked. DueRadar is a helpful
          second memory, not a guarantee against late fees, failed payments, or missed cancellation
          windows.
        </p>
        <p>
          We aim to keep the service available, but maintenance, provider outages and security work
          may interrupt it. We may change or discontinue features with reasonable notice. If we
          discontinue the service entirely, we will give you time to export your data.
        </p>
      </Section>

      <Section title="6. Third-party services">
        <p>
          Links to providers and third-party websites are there for convenience. Their terms and
          privacy practices apply to them, not to DueRadar. A provider name or logo does not mean we
          are affiliated with or endorsed by that provider.
        </p>
      </Section>

      <Section title="7. Fees and changes">
        <p>
          DueRadar's Free plan supports up to five active items and basic reminders. New accounts can
          choose later and track items manually; there is no time-limited free trial. Importing
          pasted text, forwarded email, Gmail scans, CSV statements, or screenshots requires an
          active Plus plan. Plus includes unlimited active items and all import methods. Plus is available for GHS 9.99
          per month or GHS 99 per year, paid in advance through Paystack hosted checkout. Each
          purchase is a one-time payment for the selected term; there is no automatic renewal. You
          can renew manually, and any unused paid access is added to the new term. Accounts existing
          when paid plans launched keep their grandfathered Plus access. Refund requests are reviewed
          case by case under applicable law; contact support. We show the price and term before
          checkout. You can export and delete your data at any time.
        </p>
        <p>
          We may update these terms. Material changes will be announced in the app or by email before
          they take effect. Continuing to use the service after that means you accept the updated
          terms.
        </p>
      </Section>

      <Section title="8. Disclaimers and liability">
        <p>
          The service is provided on an "as is" and "as available" basis. To the fullest extent
          permitted by Ghanaian law, DueRadar disclaims implied warranties of merchantability,
          fitness for a particular purpose and non-infringement.
        </p>
        <p>
          DueRadar is not liable for indirect, incidental or consequential losses, including late
          fees, missed cancellations, lost profits or data you did not export, arising from your use of
          the service. Nothing in these terms limits liability that cannot be limited by law, including
          for fraud or wilful misconduct.
        </p>
      </Section>

      <Section title="9. Termination">
        <p>
          You can delete your account at any time from Settings. Deletion is immediate and permanent.
          If you connected Gmail, deleting your account removes DueRadar's saved token, but may not
          revoke Google's authorization. Remove DueRadar from your Google Account's third-party
          connections if you also want to revoke it.
          We may suspend or end access if these terms are breached or if we are required to by law. If
          we terminate without cause, we will give you an opportunity to export your data first where
          reasonably possible.
        </p>
      </Section>

      <Section title="10. Governing law and contact">
        <p>
          These terms are governed by the laws of the Republic of Ghana, and the courts of Ghana have
          jurisdiction over disputes, without affecting any mandatory consumer protections you may
          have.
        </p>
        <p className="flex items-center gap-2 font-medium text-ink">
          <Mail className="h-4 w-4 text-brand-700" />
          <a href={`mailto:${SUPPORT}`} className="text-brand-700 hover:underline">
            {SUPPORT}
          </a>
        </p>
      </Section>
    </LegalShell>
  );
}

/* -------------------------------- Security --------------------------------- */

export function SecurityPage() {
  return (
    <LegalShell>
      <LegalHeader
        eyebrow="Security"
        title="How DueRadar protects your account and dates."
        intro="Security is mostly about collecting less and enforcing ownership everywhere. Here is what we do, what we deliberately do not store, and how to report a problem."
      />

      <Section title="What we store, and what we refuse to store">
        <p>
          DueRadar keeps dates, amounts, labels and notes that you type. It does not store full card
          numbers, CVVs, mobile-money PINs, bank passwords or bank account numbers. Payment methods in
          Settings are labels such as "MTN MoMo" or "Visa ending 4242", not credentials.
        </p>
        <p>
          Because we never hold payment credentials, there is nothing of that kind to leak from
          DueRadar. Your actual payment relationships stay with your bank, telco or card issuer.
        </p>
      </Section>

      <Section title="Accounts and sessions">
        <Bullets
          items={[
            "Email verification is required before an account is usable.",
            "Passwords are salted and hashed by our authentication provider. Plain-text passwords are never stored or logged.",
            "Sign-in sessions use HttpOnly, SameSite cookies served from our own domain, with Secure cookies in production.",
            "API requests are authenticated with a short-lived signed token verified against our auth provider's public keys, or with the first-party session cookie.",
            "Signing out revokes the session and clears the local token cache.",
            "A password reset revokes existing sessions.",
          ]}
        />
        <p>
          Two-factor authentication is not available yet. If you need it for a high-risk account,
          contact us before relying on DueRadar for sensitive records.
        </p>
      </Section>

      <Section title="Ownership on every request">
        <p>
          Every record is tied to a user ID. Reads and writes filter by that ID at the database layer,
          so a guessed record ID returns "not found" rather than another person's bill. Export,
          account deletion, devices and notifications follow the same rule. Administrative audit
          records contain action metadata, not your bill contents.
        </p>
      </Section>

      <Section title="Encryption and hosting">
        <Bullets
          items={[
            "Traffic between your browser and DueRadar is encrypted with TLS.",
            "Our database provider encrypts stored data at rest and restricts access to the application role.",
            "Gmail OAuth tokens are encrypted by the application with AES-256-GCM before they are stored.",
            "Application secrets, database credentials and email keys live in the hosting provider's encrypted environment storage, never in the repository.",
            "Development and production use separate database branches and separate credentials.",
            "Database migrations run under an advisory lock so two instances cannot race each other.",
          ]}
        />
      </Section>

      <Section title="Notifications and lock screens">
        <p>
          Push and email reminders can include a bill name, amount and due date. Those reminders may
          be visible on a locked phone or shared inbox. You can turn push off per device, turn email
          off in Settings, or remove individual records. In-app alerts remain inside your signed-in
          account.
        </p>
      </Section>

      <Section title="Retention and deletion">
        <p>
          Raw imports are erased within 72 hours. Inbound email and webhook payloads are purged after
          30 days. Delivery and audit logs expire after 12 months. Deleting your account removes your
          records, credentials and sessions immediately in a single transaction; only a minimal,
          non-identifying deletion audit record remains.
        </p>
      </Section>

      <Section title="Reporting a vulnerability">
        <p>
          If you find a security issue, please email{" "}
          <a href={`mailto:${SUPPORT}`} className="font-semibold text-brand-700 hover:underline">
            {SUPPORT}
          </a>{" "}
          with enough detail to reproduce it. Do not access other users' data, run disruptive tests, or
          publish details before we have had a reasonable chance to fix the issue. We will acknowledge
          your report, keep you updated, and credit you if you would like.
        </p>
        <p>
          Reports about missing security headers or best-practice suggestions are welcome, but the
          fastest path is a concrete reproduction against a test account you control.
        </p>
      </Section>

      <Section title="Limits">
        <p>
          No service can promise perfect security. We reduce risk by collecting little, encrypting
          traffic, keeping sessions short-lived and limiting who can reach production data. If you
          believe your account has been compromised, change your password, sign out other devices,
          and contact us immediately.
        </p>
      </Section>
    </LegalShell>
  );
}
