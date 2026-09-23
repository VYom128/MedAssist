import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config/env.js';
import { logger, serializeError } from '../utils/logger.js';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  /** Links in the message. The console transport prints these (dev/test only). */
  links?: string[];
}

let smtp: Transporter | undefined;

function getSmtp(): Transporter {
  const { host, port, user, pass } = config.email.smtp;
  smtp ??= nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    ...(user && pass ? { auth: { user, pass } } : {}),
  });
  return smtp;
}

async function send(message: EmailMessage): Promise<void> {
  if (config.email.transport === 'console') {
    // Dev/test only (env validation forbids it in production). Prints no message body.
    logger.info(
      { to: message.to, subject: message.subject, links: message.links ?? [] },
      'Email (console transport)',
    );
    return;
  }
  await getSmtp().sendMail({
    from: config.email.from,
    to: message.to,
    subject: message.subject,
    text: message.text,
  });
}

const link = (path: string) => `${config.clientUrl}${path}`;

/**
 * Transactional email. Full notifications (templates, in-app, preferences) come in Phase 10.
 * Emails never contain patient data (spec §10.3). Calls go through `emailService.send` so tests
 * can spy on it.
 */
export const emailService = {
  send,

  /** Password reset link (valid 30 min). */
  sendPasswordReset(to: string, token: string) {
    const url = link(`/reset-password/${token}`);
    return emailService.send({
      to,
      subject: 'Reset your MedAssist password',
      text:
        `We received a request to reset your MedAssist password.\n\n` +
        `Reset it here (the link expires in 30 minutes): ${url}\n\n` +
        `If you did not ask for this, you can ignore this email.`,
      links: [url],
    });
  },

  /** "Set your password" link for a new staff account (valid 72 h). */
  sendAccountSetup(to: string, firstName: string, token: string) {
    const url = link(`/reset-password/${token}`);
    return emailService.send({
      to,
      subject: 'Your MedAssist account',
      text:
        `Hello ${firstName},\n\nAn account has been created for you on MedAssist.\n\n` +
        `Set your password here (the link expires in 72 hours): ${url}`,
      links: [url],
    });
  },
};

/** Sends without waiting; failures are logged. Used where timing must not reveal anything. */
export function sendInBackground(sending: () => Promise<void>, kind: string): void {
  sending().catch((err: unknown) =>
    logger.error({ err: serializeError(err), kind }, 'Email sending failed'),
  );
}
