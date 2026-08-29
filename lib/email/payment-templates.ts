import "server-only";

// Client-facing payment emails: receipts, payment reminders, and change
// order approval requests. Inline styles only — Gmail/Outlook strip
// <style> blocks. Visual language matches proposal-template.ts (white
// card on #f4f4f5, water-blue #14688C CTAs).

const BLUE = "#14688C";

function money(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

function dateLabel(d: Date): string {
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

const METHOD_LABEL: Record<string, string> = {
  CARD: "Card",
  CASH: "Cash",
  CHECK: "Check",
  BANK_TRANSFER: "Bank transfer",
  OTHER: "Other",
};

function shell(title: string, inner: string, footer: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#18181b;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f5;padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border-radius:16px;border:1px solid #e4e4e7;box-shadow:0 1px 3px rgba(0,0,0,0.04);overflow:hidden;">
            ${inner}
          </table>
          <div style="margin-top:14px;font-size:11px;color:#a1a1aa;">
            ${footer}
          </div>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function row(label: string, value: string, strong = false): string {
  return `<tr>
    <td style="padding:6px 0;font-size:13px;color:#71717a;">${escapeHtml(label)}</td>
    <td align="right" style="padding:6px 0;font-size:13px;color:#18181b;font-weight:${strong ? 700 : 500};">${value}</td>
  </tr>`;
}

/* ------------------------------------------------------------------ */
/*  Receipt (auto-sent when an installment is marked paid)             */
/* ------------------------------------------------------------------ */

export type ReceiptEmailVars = {
  clientFirstName: string;
  companyName: string;
  address: string;
  installmentLabel: string;
  amountCents: number;
  method: string;
  paidAt: Date;
  contractCents: number;
  paidToDateCents: number;
  remainingCents: number;
  paidInFull: boolean;
  portalUrl: string;
  receiptNumber: string;
};

export function renderReceiptEmail(v: ReceiptEmailVars): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = v.paidInFull
    ? `Paid in full — receipt for ${v.address}`
    : `Receipt — ${money(v.amountCents)} for ${v.address}`;

  const inner = `
    <tr>
      <td style="padding:28px 28px 0 28px;">
        <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#71717a;font-weight:600;">
          ${escapeHtml(v.companyName)} · Payment receipt
        </div>
        <h1 style="margin:8px 0 0 0;font-size:24px;line-height:1.25;font-weight:700;color:#0c0a09;">
          ${v.paidInFull ? "Paid in full — thank you" : `Thanks, ${escapeHtml(v.clientFirstName)} — payment received.`}
        </h1>
        <p style="margin:8px 0 0 0;font-size:14px;line-height:1.55;color:#52525b;">
          ${escapeHtml(v.address)}
        </p>
      </td>
    </tr>
    <tr>
      <td style="padding:20px 28px 0 28px;">
        <div style="background:#fafafa;border:1px solid #e4e4e7;border-radius:12px;padding:16px 18px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            ${row("Receipt #", escapeHtml(v.receiptNumber))}
            ${row("Payment", escapeHtml(v.installmentLabel))}
            ${row("Amount paid", money(v.amountCents), true)}
            ${row("Method", escapeHtml(METHOD_LABEL[v.method] ?? v.method))}
            ${row("Date", dateLabel(v.paidAt))}
          </table>
          <div style="border-top:1px solid #e4e4e7;margin:12px 0;"></div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            ${row("Contract total", money(v.contractCents))}
            ${row("Paid to date", money(v.paidToDateCents))}
            ${
              v.paidInFull
                ? row("Balance", "PAID IN FULL ✓", true)
                : row("Remaining balance", money(v.remainingCents), true)
            }
          </table>
        </div>
      </td>
    </tr>
    <tr>
      <td align="center" style="padding:24px 28px;">
        <a href="${escapeAttr(v.portalUrl)}" style="display:inline-block;background:${BLUE};color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 26px;border-radius:12px;">
          View project &amp; payment history
        </a>
        <div style="margin-top:10px;font-size:12px;color:#71717a;">
          Keep this email for your records — it's your official receipt.
        </div>
      </td>
    </tr>`;

  const html = shell(
    subject,
    inner,
    `Receipt issued by ${escapeHtml(v.companyName)} via FenceScan.`,
  );

  const text = [
    v.paidInFull
      ? `Paid in full — thank you!`
      : `Payment received — thank you, ${v.clientFirstName}.`,
    ``,
    `Receipt #: ${v.receiptNumber}`,
    `Property: ${v.address}`,
    `Payment: ${v.installmentLabel}`,
    `Amount paid: ${money(v.amountCents)}`,
    `Method: ${METHOD_LABEL[v.method] ?? v.method}`,
    `Date: ${dateLabel(v.paidAt)}`,
    ``,
    `Contract total: ${money(v.contractCents)}`,
    `Paid to date: ${money(v.paidToDateCents)}`,
    v.paidInFull
      ? `Balance: PAID IN FULL`
      : `Remaining balance: ${money(v.remainingCents)}`,
    ``,
    `Project & payment history: ${v.portalUrl}`,
  ].join("\n");

  return { subject, html, text };
}

/* ------------------------------------------------------------------ */
/*  Payment reminder (manual button + daily cron)                      */
/* ------------------------------------------------------------------ */

export type ReminderEmailVars = {
  clientFirstName: string;
  companyName: string;
  address: string;
  installmentLabel: string;
  amountCents: number;
  dueAt: Date | null;
  overdue: boolean;
  /** Hosted Square/Stripe/Stax invoice for THIS installment — the exact
   *  amount, card or bank. When present it's the one true pay button
   *  and the generic profile links below are skipped. */
  payUrl?: string | null;
  stripeUrl?: string | null;
  squareUrl?: string | null;
  portalUrl: string;
};

export function renderReminderEmail(v: ReminderEmailVars): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = v.overdue
    ? `Payment reminder — ${money(v.amountCents)} past due for ${v.address}`
    : `Payment reminder — ${money(v.amountCents)} due for ${v.address}`;

  const dueLine = v.dueAt
    ? v.overdue
      ? `was due ${dateLabel(v.dueAt)}`
      : `due ${dateLabel(v.dueAt)}`
    : "due on completion";

  // A live invoice for this exact amount beats the generic profile
  // links — show one or the other, never both.
  const payButtons = v.payUrl
    ? `<a href="${escapeAttr(v.payUrl)}" style="display:inline-block;background:${BLUE};color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 26px;border-radius:12px;margin:4px;">Pay ${money(v.amountCents)} now — card or bank</a>`
    : [
        v.stripeUrl
          ? `<a href="${escapeAttr(v.stripeUrl)}" style="display:inline-block;background:${BLUE};color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 26px;border-radius:12px;margin:4px;">Pay ${money(v.amountCents)} online</a>`
          : "",
        v.squareUrl
          ? `<a href="${escapeAttr(v.squareUrl)}" style="display:inline-block;background:${v.stripeUrl ? "#ffffff" : BLUE};color:${v.stripeUrl ? "#18181b" : "#ffffff"};border:1px solid ${v.stripeUrl ? "#e4e4e7" : BLUE};text-decoration:none;font-weight:600;font-size:15px;padding:13px 26px;border-radius:12px;margin:4px;">Pay with Square</a>`
          : "",
      ].join("");

  const inner = `
    <tr>
      <td style="padding:28px 28px 0 28px;">
        <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#71717a;font-weight:600;">
          ${escapeHtml(v.companyName)} · Payment reminder
        </div>
        <h1 style="margin:8px 0 0 0;font-size:24px;line-height:1.25;font-weight:700;color:#0c0a09;">
          Hi ${escapeHtml(v.clientFirstName)} — a friendly reminder.
        </h1>
        <p style="margin:8px 0 0 0;font-size:14px;line-height:1.55;color:#52525b;">
          The <strong>${escapeHtml(v.installmentLabel)}</strong> of
          <strong>${money(v.amountCents)}</strong> for
          ${escapeHtml(v.address)} is ${escapeHtml(dueLine)}.
        </p>
      </td>
    </tr>
    <tr>
      <td align="center" style="padding:24px 28px 8px 28px;">
        ${payButtons || `<div style="font-size:14px;color:#3f3f46;">Paying by cash or check? Just hand it to your contractor — they'll mark it received and you'll get a receipt automatically.</div>`}
      </td>
    </tr>
    <tr>
      <td align="center" style="padding:8px 28px 24px 28px;">
        <div style="font-size:12px;color:#71717a;line-height:1.6;">
          Paying by cash or check instead? No problem — your contractor will mark it received.<br />
          <a href="${escapeAttr(v.portalUrl)}" style="color:${BLUE};">View your project &amp; payment schedule</a>
        </div>
      </td>
    </tr>`;

  const html = shell(
    subject,
    inner,
    `Sent by ${escapeHtml(v.companyName)} via FenceScan.`,
  );

  const text = [
    `Hi ${v.clientFirstName},`,
    ``,
    `A friendly reminder: the ${v.installmentLabel} of ${money(v.amountCents)} for ${v.address} is ${dueLine}.`,
    ``,
    v.payUrl ? `Pay now (card or bank): ${v.payUrl}` : "",
    !v.payUrl && v.stripeUrl ? `Pay online: ${v.stripeUrl}` : "",
    !v.payUrl && v.squareUrl ? `Pay with Square: ${v.squareUrl}` : "",
    `Paying by cash or check? Just hand it to your contractor.`,
    ``,
    `Project & payment schedule: ${v.portalUrl}`,
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html, text };
}

/* ------------------------------------------------------------------ */
/*  Change order — approval request to the client                      */
/* ------------------------------------------------------------------ */

export type ChangeOrderEmailVars = {
  clientFirstName: string;
  companyName: string;
  address: string;
  number: number;
  title: string;
  description: string | null;
  amountCents: number;
  newContractCents: number;
  portalUrl: string;
};

export function renderChangeOrderEmail(v: ChangeOrderEmailVars): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = `Approval needed — change order #${v.number} for ${v.address}`;

  const inner = `
    <tr>
      <td style="padding:28px 28px 0 28px;">
        <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#71717a;font-weight:600;">
          ${escapeHtml(v.companyName)} · Change order #${v.number}
        </div>
        <h1 style="margin:8px 0 0 0;font-size:24px;line-height:1.25;font-weight:700;color:#0c0a09;">
          ${escapeHtml(v.clientFirstName)}, extra work needs your OK.
        </h1>
        <p style="margin:8px 0 0 0;font-size:14px;line-height:1.55;color:#52525b;">
          While working at ${escapeHtml(v.address)}, ${escapeHtml(v.companyName)} found additional work that isn't in the original contract. Nothing is charged unless you approve.
        </p>
      </td>
    </tr>
    <tr>
      <td style="padding:20px 28px 0 28px;">
        <div style="background:#fafafa;border:1px solid #e4e4e7;border-radius:12px;padding:16px 18px;">
          <div style="font-size:15px;font-weight:700;color:#0c0a09;">${escapeHtml(v.title)}</div>
          ${
            v.description
              ? `<div style="margin-top:6px;font-size:13px;line-height:1.6;color:#3f3f46;">${escapeHtml(v.description).replace(/\n/g, "<br />")}</div>`
              : ""
          }
          <div style="border-top:1px solid #e4e4e7;margin:12px 0;"></div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            ${row("Additional charge", money(v.amountCents), true)}
            ${row("New contract total if approved", money(v.newContractCents))}
          </table>
        </div>
      </td>
    </tr>
    <tr>
      <td align="center" style="padding:24px 28px;">
        <a href="${escapeAttr(v.portalUrl)}" style="display:inline-block;background:${BLUE};color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:14px 28px;border-radius:12px;">
          Review &amp; approve online
        </a>
        <div style="margin-top:10px;font-size:12px;color:#71717a;">
          Approve or decline in one click — it's added to your existing project invoice.
        </div>
      </td>
    </tr>`;

  const html = shell(
    subject,
    inner,
    `Sent by ${escapeHtml(v.companyName)} via FenceScan.`,
  );

  const text = [
    `${v.clientFirstName}, extra work at ${v.address} needs your approval.`,
    ``,
    `Change order #${v.number}: ${v.title}`,
    v.description ?? "",
    ``,
    `Additional charge: ${money(v.amountCents)}`,
    `New contract total if approved: ${money(v.newContractCents)}`,
    ``,
    `Review & approve: ${v.portalUrl}`,
    ``,
    `Nothing is charged unless you approve.`,
  ]
    .filter((l) => l !== undefined)
    .join("\n");

  return { subject, html, text };
}

/* ------------------------------------------------------------------ */
/*  Change order — decision notice to the contractor                   */
/* ------------------------------------------------------------------ */

export type ChangeOrderDecisionVars = {
  contractorName: string;
  clientName: string;
  address: string;
  number: number;
  title: string;
  amountCents: number;
  approved: boolean;
  declineReason?: string | null;
  dashUrl: string;
};

export function renderChangeOrderDecisionEmail(v: ChangeOrderDecisionVars): {
  subject: string;
  html: string;
  text: string;
} {
  const verb = v.approved ? "approved" : "declined";
  const subject = `${v.approved ? "✓ Approved" : "✕ Declined"} — change order #${v.number} for ${v.address}`;

  const inner = `
    <tr>
      <td style="padding:28px;">
        <h1 style="margin:0;font-size:22px;font-weight:700;color:${v.approved ? "#047857" : "#be123c"};">
          Change order ${verb}
        </h1>
        <p style="margin:10px 0 0 0;font-size:14px;line-height:1.6;color:#3f3f46;">
          ${escapeHtml(v.clientName)} ${verb} <strong>change order #${v.number} — ${escapeHtml(v.title)}</strong>
          (${money(v.amountCents)}) for ${escapeHtml(v.address)}.
          ${
            v.approved
              ? "The amount was added to the contract total and to the payment schedule."
              : v.declineReason
                ? `Reason: “${escapeHtml(v.declineReason)}”`
                : ""
          }
        </p>
        <p style="margin:20px 0 0 0;">
          <a href="${escapeAttr(v.dashUrl)}" style="display:inline-block;background:${BLUE};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 20px;border-radius:10px;">Open dashboard</a>
        </p>
      </td>
    </tr>`;

  const html = shell(subject, inner, "FenceScan · change order update");

  const text = [
    `Change order ${verb}`,
    ``,
    `${v.clientName} ${verb} change order #${v.number} — ${v.title} (${money(v.amountCents)}) for ${v.address}.`,
    v.approved
      ? "The amount was added to the contract total and payment schedule."
      : (v.declineReason ? `Reason: ${v.declineReason}` : ""),
    ``,
    `Dashboard: ${v.dashUrl}`,
  ].join("\n");

  return { subject, html, text };
}

/* ------------------------------------------------------------------ */
/*  Invoice canceled — apology to the client                           */
/* ------------------------------------------------------------------ */

export type InvoiceApologyEmailVars = {
  clientFirstName: string;
  companyName: string;
  address: string;
  installmentLabel: string;
  amountCents: number;
  /** Optional contractor-written line ("wrong amount — corrected invoice
   *  on the way"), shown verbatim to the client. */
  note?: string | null;
};

/**
 * Sent when the contractor revokes an invoice that went out by mistake.
 * Says sorry plainly, tells them the pay link is dead, and covers the
 * race where they already paid — "payment request" rather than
 * "invoice" so it reads right whether they got the provider's email or
 * only ever saw a pay button in the portal or a reminder.
 */
export function renderInvoiceApologyEmail(v: InvoiceApologyEmailVars): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = `Please disregard that payment request — ${v.companyName}`;

  const inner = `
    <tr>
      <td style="padding:28px;">
        <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#71717a;font-weight:600;">
          ${escapeHtml(v.companyName)} · Our apologies
        </div>
        <h1 style="margin:8px 0 0 0;font-size:24px;line-height:1.25;font-weight:700;color:#0c0a09;">
          Hi ${escapeHtml(v.clientFirstName)} — please disregard that one.
        </h1>
        <p style="margin:12px 0 0 0;font-size:14px;line-height:1.6;color:#52525b;">
          The payment request for the <strong>${escapeHtml(v.installmentLabel)}</strong>
          of <strong>${money(v.amountCents)}</strong> for ${escapeHtml(v.address)}
          went out by mistake, and we've canceled it — the pay link on it no
          longer works, and there's nothing you need to do.
        </p>
        ${
          v.note
            ? `<p style="margin:12px 0 0 0;font-size:14px;line-height:1.6;color:#52525b;">${escapeHtml(v.note)}</p>`
            : ""
        }
        <p style="margin:12px 0 0 0;font-size:14px;line-height:1.6;color:#52525b;">
          If you already paid it, don't worry — we see the payment on our side
          and it counts toward your balance; we'll sort out anything else
          ourselves. Sorry for the confusion, and thank you for your patience.
        </p>
        <p style="margin:16px 0 0 0;font-size:14px;color:#3f3f46;">— ${escapeHtml(v.companyName)}</p>
      </td>
    </tr>`;

  const html = shell(
    subject,
    inner,
    `Sent by ${escapeHtml(v.companyName)} via FenceScan.`,
  );

  const text = [
    `Hi ${v.clientFirstName},`,
    ``,
    `Please disregard the payment request for the ${v.installmentLabel} of ${money(v.amountCents)} for ${v.address} — it went out by mistake and has been canceled. The pay link no longer works, and there's nothing you need to do.`,
    v.note ? `` : null,
    v.note ?? null,
    ``,
    `If you already paid it, don't worry — we see the payment on our side and it counts toward your balance. Sorry for the confusion!`,
    ``,
    `— ${v.companyName}`,
  ]
    .filter((l): l is string => l !== null)
    .join("\n");

  return { subject, html, text };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
