/**
 * Transactional email templates. Emails must never contain medical data (spec §10.3): only
 * account information and links to log in.
 */

export interface EmailTemplate {
  subject: string;
  text: string;
  html: string;
  /** Links in the message (the console transport prints these in dev/test). */
  links: string[];
}

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

const layout = (body: string) =>
  `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#0f172a">${body}` +
  `<p style="color:#64748b;font-size:13px">MedAssist</p></div>`;

const button = (link: string, label: string) =>
  `<p><a href="${escapeHtml(link)}" style="background:#0b6bcb;color:#fff;padding:10px 16px;` +
  `border-radius:8px;text-decoration:none;display:inline-block">${label}</a></p>`;

/** Password reset link (valid 30 minutes). */
export function passwordResetEmail(link: string): EmailTemplate {
  return {
    subject: 'Reset your MedAssist password',
    text:
      `We received a request to reset your MedAssist password.\n\n` +
      `Reset it here (the link expires in 30 minutes): ${link}\n\n` +
      `If you did not ask for this, you can ignore this email.`,
    html: layout(
      `<p>We received a request to reset your MedAssist password.</p>` +
        button(link, 'Reset password') +
        `<p>The link expires in 30 minutes. If you did not ask for this, you can ignore this email.</p>`,
    ),
    links: [link],
  };
}

/** Welcome email for a new staff account with a "set your password" link (valid 72 hours). */
export function staffWelcomeEmail(name: string, link: string): EmailTemplate {
  return {
    subject: 'Your MedAssist account',
    text:
      `Hello ${name},\n\nAn account has been created for you on MedAssist.\n\n` +
      `Set your password here (the link expires in 72 hours): ${link}`,
    html: layout(
      `<p>Hello ${escapeHtml(name)},</p><p>An account has been created for you on MedAssist.</p>` +
        button(link, 'Set your password') +
        `<p>The link expires in 72 hours.</p>`,
    ),
    links: [link],
  };
}

/**
 * Portal invitation for a registered patient, with a "set your password" link (72 hours). No
 * medical information (spec §10.3).
 */
export function patientPortalInviteEmail(name: string, link: string): EmailTemplate {
  return {
    subject: 'Your MedAssist patient portal account',
    text:
      `Hello ${name},\n\nThe clinic has created a MedAssist patient portal account for you. ` +
      `You can use it to book appointments and see your records.\n\n` +
      `Set your password here (the link expires in 72 hours): ${link}`,
    html: layout(
      `<p>Hello ${escapeHtml(name)},</p><p>The clinic has created a MedAssist patient portal ` +
        `account for you. You can use it to book appointments and see your records.</p>` +
        button(link, 'Set your password') +
        `<p>The link expires in 72 hours.</p>`,
    ),
    links: [link],
  };
}

/** Sent when reception has verified a self-registered patient: their records are available. */
export function patientRecordsLinkedEmail(name: string, link: string): EmailTemplate {
  return {
    subject: 'Your MedAssist records are now available',
    text:
      `Hello ${name},\n\nThe clinic has confirmed your identity, and your records are now ` +
      `available in the MedAssist patient portal.\n\nLog in here: ${link}`,
    html: layout(
      `<p>Hello ${escapeHtml(name)},</p><p>The clinic has confirmed your identity, and your ` +
        `records are now available in the MedAssist patient portal.</p>` +
        button(link, 'Log in'),
    ),
    links: [link],
  };
}
