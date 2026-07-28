import "server-only";

export type ProposalEmailVars = {
  clientFirstName: string;
  contractorName: string;
  contractorCompany: string;
  contractorPhone: string;
  contractorEmail: string;
  address: string;
  validDays: number;
  portalUrl: string;
  /** Free-form note from the contractor's "compose" textarea. */
  message: string;
  /** Portal deep link that scrolls to the "Listen to this quote" TTS
   *  player (portalUrl + ?listen=1). Omit to hide the listen line. */
  listenUrl?: string;
};

/**
 * Renders the homeowner-facing proposal delivery email. Inline styles only —
 * Gmail and Outlook strip <style> blocks, and class-based CSS won't survive.
 */
export function renderProposalEmail(v: ProposalEmailVars): {
  html: string;
  text: string;
} {
  const safeMsg = escapeHtml(v.message).replace(/\n/g, "<br />");

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(`Your fence quote from ${v.contractorCompany}`)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#18181b;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f5;padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border-radius:16px;border:1px solid #e4e4e7;box-shadow:0 1px 3px rgba(0,0,0,0.04);overflow:hidden;">
            <tr>
              <td style="padding:28px 28px 0 28px;">
                <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#71717a;font-weight:600;">
                  ${escapeHtml(v.contractorCompany)}
                </div>
                <h1 style="margin:8px 0 0 0;font-size:24px;line-height:1.25;font-weight:700;color:#0c0a09;">
                  Your fence quote is ready, ${escapeHtml(v.clientFirstName)}.
                </h1>
                <p style="margin:8px 0 0 0;font-size:14px;line-height:1.55;color:#52525b;">
                  ${escapeHtml(v.address)} · pricing locked for ${v.validDays} days
                </p>
              </td>
            </tr>

            <tr>
              <td style="padding:20px 28px 0 28px;">
                <div style="background:#fafafa;border:1px solid #e4e4e7;border-radius:12px;padding:16px;font-size:14px;line-height:1.6;color:#3f3f46;">
                  ${safeMsg}
                </div>
              </td>
            </tr>

            <tr>
              <td align="center" style="padding:24px 28px;">
                <a href="${escapeAttr(v.portalUrl)}" style="display:inline-block;background:#14688C;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:14px 28px;border-radius:12px;">
                  Review &amp; accept
                </a>
                <div style="margin-top:10px;font-size:12px;color:#71717a;">
                  Three packages · digital signature · pay your deposit in one click
                </div>
                ${
                  v.listenUrl
                    ? `<div style="margin-top:14px;font-size:13px;color:#52525b;">
                  🎧 On the road? <a href="${escapeAttr(v.listenUrl)}" style="color:#14688C;font-weight:600;">Listen to a one-minute summary</a> of your quote.
                </div>`
                    : ""
                }
              </td>
            </tr>

            <tr>
              <td style="padding:0 28px 28px 28px;">
                <div style="border-top:1px solid #f4f4f5;padding-top:16px;font-size:12px;color:#71717a;line-height:1.6;">
                  Questions? Reply to this email or call ${escapeHtml(v.contractorName)} at
                  <a href="tel:${escapeAttr(v.contractorPhone)}" style="color:#3f3f46;text-decoration:none;font-weight:500;">${escapeHtml(v.contractorPhone)}</a>.
                  <br />
                  If the button doesn't work, paste this link into your browser:<br />
                  <a href="${escapeAttr(v.portalUrl)}" style="color:#14688C;word-break:break-all;">${escapeHtml(v.portalUrl)}</a>
                </div>
              </td>
            </tr>
          </table>

          <div style="margin-top:14px;font-size:11px;color:#a1a1aa;">
            Sent securely via FenceScan on behalf of ${escapeHtml(v.contractorCompany)}.
            <br />
            <a href="${escapeAttr(originOf(v.portalUrl))}/?ref=proposal-email" style="color:#a1a1aa;text-decoration:underline;">
              Powered by FenceScan — send quotes like this in 60 seconds
            </a>
          </div>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = [
    `Your fence quote from ${v.contractorCompany} is ready, ${v.clientFirstName}.`,
    `Property: ${v.address}`,
    `Pricing locked for ${v.validDays} days.`,
    "",
    v.message,
    "",
    `Review and accept: ${v.portalUrl}`,
    ...(v.listenUrl
      ? ["", `On the road? Listen to a one-minute audio summary: ${v.listenUrl}`]
      : []),
    "",
    `Questions? Reply to this email or call ${v.contractorName} at ${v.contractorPhone}.`,
  ].join("\n");

  return { html, text };
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

/** Origin of the portal link — the landing lives on the same host. */
function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "https://fencescan.com";
  }
}
