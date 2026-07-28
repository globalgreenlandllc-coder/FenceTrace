import "server-only";

// Price-negotiation emails: the CLIENT asks for a lower price (or counters
// back) → notify the CONTRACTOR; the CONTRACTOR agrees / counters / declines
// → notify the CLIENT. Inline styles only (Gmail/Outlook strip <style>).
// Visual language matches payment-templates.ts / proposal-template.ts:
// white card on #f4f4f5, water-blue #14688C CTAs.

const BLUE = "#14688C";
const GREEN = "#047857";
const ROSE = "#be123c";

function money(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

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

function button(href: string, label: string, color = BLUE): string {
  return `<a href="${escapeAttr(href)}" style="display:inline-block;background:${color};color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:14px 28px;border-radius:12px;">${escapeHtml(label)}</a>`;
}

/* ------------------------------------------------------------------ */
/*  Client made a move → notify the contractor                         */
/* ------------------------------------------------------------------ */

export type DiscountToContractorVars = {
  kind: "requested" | "countered" | "withdrew";
  contractorName: string;
  clientName: string;
  address: string;
  packageName: string;
  listedCents: number;
  /** The price the client is now asking for (their latest offer). */
  askCents: number;
  message: string | null;
  dashUrl: string;
};

export function renderDiscountToContractorEmail(v: DiscountToContractorVars): {
  subject: string;
  html: string;
  text: string;
} {
  const first = v.clientName.trim().split(/\s+/)[0] || v.clientName || "Your client";
  const offCents = Math.max(0, v.listedCents - v.askCents);

  if (v.kind === "withdrew") {
    const subject = `Price request withdrawn — ${v.address}`;
    const inner = `
      <tr>
        <td style="padding:28px;">
          <h1 style="margin:0;font-size:22px;font-weight:700;color:#0c0a09;">Price request withdrawn</h1>
          <p style="margin:10px 0 0 0;font-size:14px;line-height:1.6;color:#3f3f46;">
            ${escapeHtml(v.clientName || "Your client")} withdrew their price request for <strong>${escapeHtml(v.address)}</strong>. The proposal stands at its listed price — no action needed.
          </p>
          <p style="margin:20px 0 0 0;">${button(v.dashUrl, "Open dashboard")}</p>
        </td>
      </tr>`;
    return {
      subject,
      html: shell(subject, inner, "FenceScan · price request update"),
      text: [
        `Price request withdrawn`,
        ``,
        `${v.clientName || "Your client"} withdrew their price request for ${v.address}. The proposal stands at its listed price.`,
        ``,
        `Dashboard: ${v.dashUrl}`,
      ].join("\n"),
    };
  }

  const verb = v.kind === "requested" ? "asked for a better price" : "sent you a counter-offer";
  const subject =
    v.kind === "requested"
      ? `New price request — ${money(v.askCents)} for ${v.address}`
      : `Counter-offer — ${first} now asks ${money(v.askCents)} for ${v.address}`;

  const inner = `
    <tr>
      <td style="padding:28px 28px 0 28px;">
        <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#71717a;font-weight:600;">
          Price negotiation · ${escapeHtml(v.packageName)}
        </div>
        <h1 style="margin:8px 0 0 0;font-size:24px;line-height:1.25;font-weight:700;color:#0c0a09;">
          ${escapeHtml(first)} ${escapeHtml(verb)}.
        </h1>
        <p style="margin:8px 0 0 0;font-size:14px;line-height:1.55;color:#52525b;">
          For ${escapeHtml(v.address)}. You're in control — agree, send a counter, or decline. Nothing changes until you respond.
        </p>
      </td>
    </tr>
    <tr>
      <td style="padding:20px 28px 0 28px;">
        <div style="background:#fafafa;border:1px solid #e4e4e7;border-radius:12px;padding:16px 18px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            ${row("Listed price", money(v.listedCents))}
            ${row(v.kind === "requested" ? "They're asking" : "They now ask", money(v.askCents), true)}
            ${offCents > 0 ? row("Discount requested", `${money(offCents)} off`) : ""}
          </table>
          ${
            v.message
              ? `<div style="border-top:1px solid #e4e4e7;margin:12px 0;"></div><div style="font-size:13px;line-height:1.6;color:#3f3f46;"><span style="color:#71717a;">Their note:</span> “${escapeHtml(v.message).replace(/\n/g, "<br />")}”</div>`
              : ""
          }
        </div>
      </td>
    </tr>
    <tr>
      <td align="center" style="padding:24px 28px;">
        ${button(v.dashUrl, "Review & respond")}
        <div style="margin-top:10px;font-size:12px;color:#71717a;">
          See your margin at their price and send a smart counter in one tap.
        </div>
      </td>
    </tr>`;

  const html = shell(subject, inner, "FenceScan · price negotiation");
  const text = [
    `${first} ${verb} for ${v.address} (${v.packageName}).`,
    ``,
    `Listed price: ${money(v.listedCents)}`,
    `${v.kind === "requested" ? "They're asking" : "They now ask"}: ${money(v.askCents)}`,
    offCents > 0 ? `Discount requested: ${money(offCents)} off` : "",
    v.message ? `Their note: "${v.message}"` : "",
    ``,
    `Review & respond: ${v.dashUrl}`,
    ``,
    `Nothing changes until you respond — agree, counter, or decline.`,
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html, text };
}

/* ------------------------------------------------------------------ */
/*  Contractor made a move → notify the client                         */
/* ------------------------------------------------------------------ */

export type DiscountToClientVars = {
  kind: "countered" | "agreed" | "declined";
  clientFirstName: string;
  companyName: string;
  address: string;
  packageName: string;
  listedCents: number;
  /** Countered: the contractor's offer. Agreed: the final agreed price. */
  offerCents: number;
  message: string | null;
  portalUrl: string;
};

export function renderDiscountToClientEmail(v: DiscountToClientVars): {
  subject: string;
  html: string;
  text: string;
} {
  const savings = Math.max(0, v.listedCents - v.offerCents);

  if (v.kind === "agreed") {
    const subject = `Good news — your price is approved for ${v.address}`;
    const inner = `
      <tr>
        <td style="padding:28px 28px 0 28px;">
          <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${GREEN};font-weight:600;">
            ${escapeHtml(v.companyName)} · Price approved
          </div>
          <h1 style="margin:8px 0 0 0;font-size:24px;line-height:1.25;font-weight:700;color:#0c0a09;">
            Great news, ${escapeHtml(v.clientFirstName)} — you've got a deal.
          </h1>
          <p style="margin:8px 0 0 0;font-size:14px;line-height:1.55;color:#52525b;">
            ${escapeHtml(v.companyName)} approved a new price for the ${escapeHtml(v.packageName)} at ${escapeHtml(v.address)}.
          </p>
        </td>
      </tr>
      <tr>
        <td style="padding:20px 28px 0 28px;">
          <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px 18px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              ${row("Was", money(v.listedCents))}
              ${row("Your price", money(v.offerCents), true)}
              ${savings > 0 ? row("You save", `${money(savings)} 🎉`, true) : ""}
            </table>
          </div>
        </td>
      </tr>
      <tr>
        <td align="center" style="padding:24px 28px;">
          ${button(v.portalUrl, "View & accept your proposal", GREEN)}
          <div style="margin-top:10px;font-size:12px;color:#71717a;">
            Your proposal now reflects the new price — review and accept when you're ready.
          </div>
        </td>
      </tr>`;
    return {
      subject,
      html: shell(subject, inner, `Sent by ${escapeHtml(v.companyName)} via FenceScan.`),
      text: [
        `Great news, ${v.clientFirstName} — you've got a deal.`,
        ``,
        `${v.companyName} approved a new price for the ${v.packageName} at ${v.address}.`,
        `Was: ${money(v.listedCents)}`,
        `Your price: ${money(v.offerCents)}`,
        savings > 0 ? `You save: ${money(savings)}` : "",
        ``,
        `View & accept: ${v.portalUrl}`,
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  if (v.kind === "declined") {
    const subject = `About your price request — ${v.address}`;
    const inner = `
      <tr>
        <td style="padding:28px;">
          <h1 style="margin:0;font-size:22px;font-weight:700;color:#0c0a09;">Thanks for asking, ${escapeHtml(v.clientFirstName)}.</h1>
          <p style="margin:10px 0 0 0;font-size:14px;line-height:1.6;color:#3f3f46;">
            ${escapeHtml(v.companyName)} reviewed your request but isn't able to lower the price on the ${escapeHtml(v.packageName)} for ${escapeHtml(v.address)} right now. It stays at <strong>${money(v.listedCents)}</strong>.
            ${v.message ? `<br /><br /><span style="color:#71717a;">Their note:</span> “${escapeHtml(v.message).replace(/\n/g, "<br />")}”` : ""}
          </p>
          <p style="margin:10px 0 0 0;font-size:14px;line-height:1.6;color:#3f3f46;">
            You can still review and accept the proposal at any time — or reply to this email to keep the conversation going.
          </p>
          <p style="margin:20px 0 0 0;">${button(v.portalUrl, "View your proposal")}</p>
        </td>
      </tr>`;
    return {
      subject,
      html: shell(subject, inner, `Sent by ${escapeHtml(v.companyName)} via FenceScan.`),
      text: [
        `Thanks for asking, ${v.clientFirstName}.`,
        ``,
        `${v.companyName} isn't able to lower the price on the ${v.packageName} for ${v.address} right now. It stays at ${money(v.listedCents)}.`,
        v.message ? `Their note: "${v.message}"` : "",
        ``,
        `View your proposal: ${v.portalUrl}`,
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  // countered
  const subject = `A counter-offer from ${v.companyName} — ${v.address}`;
  const inner = `
    <tr>
      <td style="padding:28px 28px 0 28px;">
        <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#71717a;font-weight:600;">
          ${escapeHtml(v.companyName)} · Counter-offer
        </div>
        <h1 style="margin:8px 0 0 0;font-size:24px;line-height:1.25;font-weight:700;color:#0c0a09;">
          ${escapeHtml(v.clientFirstName)}, here's a number that works.
        </h1>
        <p style="margin:8px 0 0 0;font-size:14px;line-height:1.55;color:#52525b;">
          ${escapeHtml(v.companyName)} responded to your price request for the ${escapeHtml(v.packageName)} at ${escapeHtml(v.address)}.
        </p>
      </td>
    </tr>
    <tr>
      <td style="padding:20px 28px 0 28px;">
        <div style="background:#fafafa;border:1px solid #e4e4e7;border-radius:12px;padding:16px 18px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            ${row("Listed price", money(v.listedCents))}
            ${row("Their counter", money(v.offerCents), true)}
            ${savings > 0 ? row("You'd save", `${money(savings)}`) : ""}
          </table>
          ${
            v.message
              ? `<div style="border-top:1px solid #e4e4e7;margin:12px 0;"></div><div style="font-size:13px;line-height:1.6;color:#3f3f46;">“${escapeHtml(v.message).replace(/\n/g, "<br />")}”</div>`
              : ""
          }
        </div>
      </td>
    </tr>
    <tr>
      <td align="center" style="padding:24px 28px;">
        ${button(v.portalUrl, "View & respond")}
        <div style="margin-top:10px;font-size:12px;color:#71717a;">
          Accept it, counter back, or keep the original — it's up to you.
        </div>
      </td>
    </tr>`;

  const html = shell(subject, inner, `Sent by ${escapeHtml(v.companyName)} via FenceScan.`);
  const text = [
    `${v.clientFirstName}, ${v.companyName} sent a counter-offer for the ${v.packageName} at ${v.address}.`,
    ``,
    `Listed price: ${money(v.listedCents)}`,
    `Their counter: ${money(v.offerCents)}`,
    savings > 0 ? `You'd save: ${money(savings)}` : "",
    v.message ? `Note: "${v.message}"` : "",
    ``,
    `View & respond: ${v.portalUrl}`,
  ]
    .filter(Boolean)
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
