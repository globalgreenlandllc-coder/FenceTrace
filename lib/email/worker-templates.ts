/**
 * Transactional email bodies for the worker system — an invite to join a crew,
 * and a new-job notification. Inline-style HTML + plain-text, matching the
 * proposal template's approach (no external CSS). Pure string builders.
 */

const WRAP = (inner: string) =>
  `<!doctype html><html><body style="margin:0;background:#f4f5f8;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#0d0d12">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
  <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e6e8ee">
  <tr><td style="padding:22px 28px;border-bottom:1px solid #eef0f4;font-size:15px;font-weight:700;letter-spacing:-.01em">FenceTrace</td></tr>
  <tr><td style="padding:28px">${inner}</td></tr>
  </table>
  <div style="color:#9aa0ac;font-size:12px;padding:16px">Sent by FenceTrace on behalf of your contractor.</div>
  </td></tr></table></body></html>`;

const BTN = (href: string, label: string) =>
  `<a href="${href}" style="display:inline-block;background:#14688C;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:10px">${label}</a>`;

export type RenderedEmail = { subject: string; html: string; text: string };

export function renderWorkerInviteEmail(args: {
  ownerName: string;
  company: string;
  acceptUrl: string;
  workerName?: string | null;
}): RenderedEmail {
  const hi = args.workerName ? `Hi ${args.workerName},` : "Hi,";
  const who = args.company || args.ownerName;
  const subject = `${who} invited you to their crew on FenceTrace`;
  const html = WRAP(
    `<p style="margin:0 0 14px;font-size:16px">${hi}</p>
     <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#3a3f4a"><strong>${who}</strong> invited you to join their crew on FenceTrace. Accept to set up your account and see the jobs they assign you — schedule, address, what to do, and your pay.</p>
     <p style="margin:0 0 22px">${BTN(args.acceptUrl, "Accept invite &amp; set up account")}</p>
     <p style="margin:0;font-size:13px;color:#9aa0ac">If the button doesn't work, paste this link:<br><span style="color:#14688C">${args.acceptUrl}</span></p>`,
  );
  const text = `${hi}\n\n${who} invited you to join their crew on FenceTrace. Accept to set up your account and see your assigned jobs.\n\nAccept: ${args.acceptUrl}\n`;
  return { subject, html, text };
}

export function renderAppointmentAssignedEmail(args: {
  company: string;
  title: string;
  typeLabel: string;
  when: string;
  address?: string | null;
  portalUrl: string;
}): RenderedEmail {
  const subject = `${args.typeLabel} from ${args.company}: ${args.title}`;
  const html = WRAP(
    `<p style="margin:0 0 14px;font-size:16px;font-weight:700">You&rsquo;re scheduled: ${args.typeLabel.toLowerCase()}</p>
     <p style="margin:0 0 6px;font-size:15px;color:#3a3f4a"><strong>${args.title}</strong></p>
     ${args.address ? `<p style="margin:0 0 4px;font-size:14px;color:#3a3f4a">${args.address}</p>` : ""}
     <p style="margin:0 0 20px;font-size:14px;color:#3a3f4a">${args.when}</p>
     <p style="margin:0 0 22px">${BTN(args.portalUrl, "View your schedule")}</p>
     <p style="margin:0;font-size:13px;color:#9aa0ac">Open your portal for the day&rsquo;s full plan — who to meet, where, and any notes.</p>`,
  );
  const text = `${args.typeLabel} from ${args.company}: ${args.title}\n${args.address ? `${args.address}\n` : ""}${args.when}\n\nYour schedule: ${args.portalUrl}\n`;
  return { subject, html, text };
}

export function renderJobOfferEmail(args: {
  company: string;
  jobTitle: string;
  address: string;
  when: string;
  portalUrl: string;
}): RenderedEmail {
  const subject = `New job from ${args.company}: ${args.jobTitle}`;
  const html = WRAP(
    `<p style="margin:0 0 14px;font-size:16px;font-weight:700">New job offer</p>
     <p style="margin:0 0 6px;font-size:15px;color:#3a3f4a"><strong>${args.jobTitle}</strong></p>
     <p style="margin:0 0 4px;font-size:14px;color:#3a3f4a">${args.address}</p>
     <p style="margin:0 0 20px;font-size:14px;color:#3a3f4a">${args.when}</p>
     <p style="margin:0 0 22px">${BTN(args.portalUrl, "View job &amp; respond")}</p>
     <p style="margin:0;font-size:13px;color:#9aa0ac">Open your portal to see the fence layout and accept or decline.</p>`,
  );
  const text = `New job from ${args.company}: ${args.jobTitle}\n${args.address}\n${args.when}\n\nView & respond: ${args.portalUrl}\n`;
  return { subject, html, text };
}
