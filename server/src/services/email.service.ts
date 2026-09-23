import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config/env.js';
import { logger, serializeError } from '../utils/logger.js';
import { passwordResetEmail, staffWelcomeEmail } from './email.templates.js';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
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
    // Dev/test only (env validation forbids it in production). Logs recipient, subject and links;
    // the body is not logged.
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
    ...(message.html ? { html: message.html } : {}),
  });
}

/** Link to the client's reset page; also used for new-account setup. */
const resetLink = (token: string) => `${config.clientUrl}/reset-password/${token}`;

/**
 * Transactional email. Full notifications (in-app, preferences) come in Phase 10. Calls go
 * through `emailService.send` so tests can spy on it.
 */
export const emailService = {
  send,

  /** Password reset link (valid 30 min). */
  sendPasswordReset(to: string, token: string) {
    return emailService.send({ to, ...passwordResetEmail(resetLink(token)) });
  },

  /** Welcome + "set your password" link for a new staff account (valid 72 h). */
  sendAccountSetup(to: string, firstName: string, token: string) {
    return emailService.send({ to, ...staffWelcomeEmail(firstName, resetLink(token)) });
  },
};

/** Sends an email (console or SMTP transport, per EMAIL_TRANSPORT). */
export function sendEmail(message: EmailMessage): Promise<void> {
  return emailService.send(message);
}

/** Sends without waiting; failures are logged. Used where timing must not reveal anything. */
export function sendInBackground(sending: () => Promise<void>, kind: string): void {
  sending().catch((err: unknown) =>
    logger.error({ err: serializeError(err), kind }, 'Email sending failed'),
  );
}
