import type { NotificationType } from '../config/constants.js';
import { config } from '../config/env.js';
import { getSettings } from '../modules/settings/service.js';
import { logger, serializeError } from '../utils/logger.js';
import { emailService } from './email.service.js';
import { notificationEmail } from './email.templates.js';

/**
 * Notifications (spec §11). `notify()` is the one entry point: Phase 4 only sends email; Phase 10
 * adds the in-app record and the `notification.new` Socket.IO event behind the same function.
 * Bodies and titles never contain clinical details (§10.3): emails say what happened and when,
 * and link to the app for the rest.
 */

export interface Recipient {
  /** For in-app notifications (Phase 10). */
  userId?: string | null;
  /** Where to email; null/undefined = no email for this recipient. */
  email?: string | null;
}

export interface NotifyInput {
  recipients: Recipient[];
  type: NotificationType;
  title: string;
  body: string;
  /** Path in the client app ('/patient/appointments'). */
  link?: string;
  /** Also send an email (when the clinic has email notifications on). */
  email?: boolean;
}

async function deliver({ recipients, type, title, body, link, email }: NotifyInput) {
  // TODO(Phase 10): store an in-app notification per userId and emit `notification.new`.
  if (!email) return;
  const settings = await getSettings();
  if (settings.notifications?.emailEnabled === false) return;
  const url = link ? `${config.clientUrl}${link}` : undefined;
  const addresses = [...new Set(recipients.map((r) => r.email).filter((e): e is string => !!e))];
  for (const to of addresses) {
    try {
      await emailService.send({ to, ...notificationEmail(title, body, url) });
    } catch (err) {
      logger.error({ err: serializeError(err), type }, 'Notification email failed');
    }
  }
}

/**
 * Sends a notification without blocking the caller; failures are logged, never thrown. Call it
 * after the transaction has committed. The returned promise (always resolves) is for tests.
 */
export function notify(input: NotifyInput): Promise<void> {
  return deliver(input).catch((err: unknown) =>
    logger.error({ err: serializeError(err), type: input.type }, 'Notification failed'),
  );
}
