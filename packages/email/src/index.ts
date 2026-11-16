export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  idempotencyKey?: string;
}

export interface EmailResult {
  ok: boolean;
  skipped: boolean;
  id?: string;
  error?: string;
}

export interface EmailClientConfig {
  apiKey?: string | null;
  from: string;
  replyTo?: string;
  appOrigin: string;
  supportEmail: string;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function layout(options: {
  appOrigin: string;
  supportEmail: string;
  heading: string;
  preview: string;
  body: string;
}): string {
  const { appOrigin, supportEmail, heading, preview, body } = options;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background:#f6f5f1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1c2321;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preview)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f5f1;padding:28px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #e4e1d8;">
<tr><td style="background:#0b3b36;padding:20px 26px;">
<span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:-0.02em;">DueRadar</span>
<span style="color:#8fd6c8;font-size:12px;margin-left:8px;">Ghana</span>
</td></tr>
<tr><td style="padding:30px 26px 8px;">
<h1 style="margin:0 0 14px;font-size:23px;line-height:1.25;letter-spacing:-0.02em;">${escapeHtml(heading)}</h1>
${body}
</td></tr>
<tr><td style="padding:22px 26px 28px;">
<hr style="border:none;border-top:1px solid #ece9e0;margin:0 0 16px;">
<p style="margin:0;font-size:12px;line-height:1.6;color:#68736f;">
You are receiving this because you use DueRadar.
<a href="${appOrigin}/settings" style="color:#0f766e;">Manage reminders</a> or
<a href="${appOrigin}/settings" style="color:#0f766e;">turn them off</a>.
Need help? <a href="mailto:${escapeHtml(supportEmail)}" style="color:#0f766e;">${escapeHtml(supportEmail)}</a>
</p>
</td></tr>
</table>
<p style="max-width:560px;margin:14px auto 0;font-size:11px;color:#8a938f;text-align:center;">DueRadar · Accra, Ghana · Times shown in your local time zone</p>
</td></tr>
</table>
</body>
</html>`;
}

function button(appOrigin: string, path: string, label: string, color = "#0f766e"): string {
  return `<a href="${appOrigin}${path}" style="display:inline-block;background:${color};color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 20px;border-radius:12px;">${escapeHtml(label)}</a>`;
}

export interface ReminderEmailInput {
  toName: string | null;
  itemName: string;
  itemKind: string;
  dueLabel: string;
  amountLabel: string | null;
  daysBefore: number;
  isTrial: boolean;
  appOrigin: string;
  supportEmail: string;
  itemPath: string;
}

export function buildReminderEmail(input: ReminderEmailInput): { html: string; text: string; subject: string } {
  const {
    toName,
    itemName,
    itemKind,
    dueLabel,
    amountLabel,
    daysBefore,
    isTrial,
    appOrigin,
    supportEmail,
    itemPath,
  } = input;

  const when =
    daysBefore === 0
      ? "today"
      : daysBefore === 1
        ? "tomorrow"
        : `in ${daysBefore} days`;
  const subject = isTrial
    ? `${itemName} trial ends ${when}`
    : `${itemName} ${amountLabel ? `(${amountLabel}) ` : ""}is due ${when}`;
  const heading = isTrial ? "Your free trial is ending" : "A payment is coming up";
  const greeting = toName ? `Hi ${escapeHtml(toName)},` : "Hello,";
  const detail = isTrial
    ? `Your ${escapeHtml(itemName)} free trial ends <strong>${escapeHtml(dueLabel)}</strong>. Cancel before then if you do not want to be charged.`
    : `${escapeHtml(itemName)} is a ${escapeHtml(itemKind.toLowerCase())} due <strong>${escapeHtml(dueLabel)}</strong>${
        amountLabel ? ` for <strong>${escapeHtml(amountLabel)}</strong>` : ""
      }.`;

  const body = `<p style="margin:0 0 12px;font-size:15px;line-height:1.65;color:#38423f;">${greeting}</p>
<p style="margin:0 0 18px;font-size:15px;line-height:1.65;color:#38423f;">${detail}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f8f6;border:1px solid #d9ece7;border-radius:14px;margin:0 0 22px;">
<tr><td style="padding:16px 18px;">
<div style="font-size:12px;text-transform:uppercase;letter-spacing:0.08em;color:#5c736d;margin-bottom:5px;">${escapeHtml(itemKind)}</div>
<div style="font-size:18px;font-weight:700;color:#0b3b36;">${escapeHtml(itemName)}</div>
<div style="font-size:14px;color:#4b5a56;margin-top:4px;">${escapeHtml(dueLabel)}${amountLabel ? ` · ${escapeHtml(amountLabel)}` : ""}</div>
</td></tr>
</table>
${button(appOrigin, itemPath, isTrial ? "Review the trial" : "View and mark paid")}
<p style="margin:18px 0 0;font-size:13px;line-height:1.6;color:#68736f;">If you have already paid, open DueRadar and mark this one paid so we stop reminding you.</p>`;

  const text = `${greeting}

${isTrial ? `Your ${itemName} free trial ends ${dueLabel}.` : `${itemName} (${itemKind}) is due ${dueLabel}${amountLabel ? ` for ${amountLabel}` : ""}.`}

Open DueRadar: ${appOrigin}${itemPath}

If you have already paid, mark it paid in DueRadar.
Manage reminders: ${appOrigin}/settings
Help: ${supportEmail}`;

  return {
    html: layout({ appOrigin, supportEmail, heading, preview: subject, body }),
    text,
    subject,
  };
}

export function buildTestEmail(appOrigin: string, supportEmail: string): {
  html: string;
  text: string;
  subject: string;
} {
  const subject = "Your DueRadar email test";
  const body = `<p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:#38423f;">Email delivery is working. Reminders will arrive here at your chosen time, unless quiet hours move them.</p>
${button(appOrigin, "/settings", "Open notification settings")}`;
  return {
    subject,
    html: layout({ appOrigin, supportEmail, heading: "Email delivery works", preview: subject, body }),
    text: `Email delivery is working. Reminders will arrive here at your chosen time.\n\nManage reminders: ${appOrigin}/settings\nHelp: ${supportEmail}`,
  };
}

export function createEmailClient(config: EmailClientConfig) {
  async function send(message: EmailMessage): Promise<EmailResult> {
    if (!config.apiKey) {
      console.info(`[email] RESEND_API_KEY not set; skipped "${message.subject}" to ${message.to}`);
      return { ok: false, skipped: true, error: "Email provider not configured" };
    }

    const payload = {
      from: config.from,
      to: [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text,
      reply_to: message.replyTo ?? config.replyTo,
    };

    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
          ...(message.idempotencyKey ? { "Idempotency-Key": message.idempotencyKey } : {}),
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        return {
          ok: false,
          skipped: false,
          error: `Resend ${response.status}: ${text.slice(0, 300)}`,
        };
      }

      const data = (await response.json().catch(() => ({}))) as { id?: string };
      return { ok: true, skipped: false, id: data.id };
    } catch (error) {
      return {
        ok: false,
        skipped: false,
        error: error instanceof Error ? error.message : "Unknown email error",
      };
    }
  }

  return {
    send,
    configured: Boolean(config.apiKey),
    async sendReminder(message: Omit<EmailMessage, "html" | "text" | "subject">, input: ReminderEmailInput) {
      const template = buildReminderEmail(input);
      return send({ ...message, ...template });
    },
    async sendTest(message: Omit<EmailMessage, "html" | "text" | "subject">) {
      const template = buildTestEmail(config.appOrigin, config.supportEmail);
      return send({ ...message, ...template });
    },
  };
}

export type EmailClient = ReturnType<typeof createEmailClient>;
