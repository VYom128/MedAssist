import { Types } from 'mongoose';
import {
  NOTIFICATION_CONFIG,
  NOTIFICATION_TYPES,
  type NotificationType,
  type Role,
} from '../config/constants.js';
import { config } from '../config/env.js';
import { Notification } from '../modules/notifications/model.js';
import { toView } from '../modules/notifications/serializer.js';
import { getSettings } from '../modules/settings/service.js';
import { emitNotificationNew } from '../socket/emitter.js';
import { logger, serializeError } from '../utils/logger.js';
import { enqueueEmail } from './emailQueue.js';
import { cleanNotificationData, type NotificationData } from './notificationData.js';
import { NOTIFICATION_EMAILS } from './notificationEmails/index.js';

/**
 * Notifications (spec §11, §6.24). `notify()` is the one entry point: for each recipient it
 * stores the in-app record, emits `notification.new` (the record + the new unread count) to
 * `user:<id>`, and queues the email when the type sends email, the clinic has email on and the
 * recipient has an address (patients: only with email consent – `patientRecipient()`).
 *
 * Content rules (§10.3): titles and bodies name the item type and number, never clinical
 * details; `data` passes an allow-list (ids, numbers, dates, statuses); emails come from the
 * per-type templates (notificationEmails/), which read only `data`. A `dedupeKey` makes the
 * event happen once per recipient (unique index) – jobs and retries never notify twice.
 */

export interface Recipient {
  /** The user to notify in-app (null = email only, e.g. a patient without a portal login). */
  userId?: string | null;
  /** Where to email; null/undefined = no email for this recipient. */
  email?: string | null;
  /** Greeting in account emails only. */
  name?: string | null;
}

export interface NotifyInput {
  recipients: Recipient[];
  type: NotificationType;
  title: string;
  body: string;
  /** Path in the client app ('/patient/appointments'); see notificationLink(). */
  link?: string;
  /** Ids, numbers, dates and statuses only (notificationData.ts). */
  data?: Record<string, unknown>;
  /** Set false to skip the email for this call (the type's default otherwise). */
  email?: boolean;
  /** One notification per event and recipient: `<type>:<record id>[:<version>]`. */
  dedupeKey?: string;
}

/** The client route of `type` for a role, with `:id` filled in (undefined if none). */
export function notificationLink(
  type: NotificationType,
  role: Role,
  id?: string | Types.ObjectId | null,
): string | undefined {
  const route = NOTIFICATION_CONFIG[type].routes[role];
  if (!route) return undefined;
  return id ? route.replace(':id', id.toString()) : route.replace('/:id', '');
}

/** Unread in-app notifications of a user. */
export function unreadCount(userId: string | Types.ObjectId): Promise<number> {
  return Notification.countDocuments({ recipient: userId, readAt: null });
}

const isDuplicateKey = (err: unknown) => (err as { code?: number } | null)?.code === 11000;

async function storeInApp(
  input: NotifyInput,
  userId: string,
  data: NotificationData,
  emailQueued: boolean,
) {
  const cfg = NOTIFICATION_CONFIG[input.type];
  try {
    const doc = await Notification.create({
      recipient: new Types.ObjectId(userId),
      type: input.type,
      priority: cfg.priority,
      title: input.title,
      body: input.body,
      link: input.link,
      data: Object.keys(data).length ? data : undefined,
      dedupeKey: input.dedupeKey ? `${input.dedupeKey}:${userId}` : undefined,
      channels: { inApp: true, email: { queued: emailQueued } },
    });
    emitNotificationNew(userId, {
      notification: toView(doc.toObject()),
      unreadCount: await unreadCount(userId),
    });
    return { id: doc._id, duplicate: false };
  } catch (err) {
    if (isDuplicateKey(err)) return { id: null, duplicate: true };
    throw err;
  }
}

async function deliver(input: NotifyInput): Promise<void> {
  const cfg = NOTIFICATION_CONFIG[input.type];
  let data = cleanNotificationData(input.data);
  if (data === null) {
    logger.warn({ type: input.type }, 'Notification data dropped (not on the allow-list)');
    data = {};
  }
  const settings = await getSettings();
  const transactional = !cfg.inApp; // account emails: always sent, whatever the clinic switch
  const emailOn =
    cfg.email &&
    input.email !== false &&
    (transactional || settings.notifications?.emailEnabled !== false);
  const template = NOTIFICATION_EMAILS[input.type];
  const url = input.link ? `${config.clientUrl}${input.link}` : undefined;

  const seenUsers = new Set<string>();
  const seenEmails = new Set<string>();
  for (const r of input.recipients) {
    const userId = r.userId ?? null;
    const email = emailOn && r.email && !seenEmails.has(r.email) ? r.email : null;
    if (userId && seenUsers.has(userId)) continue;
    if (!userId && !email) continue;
    if (userId) seenUsers.add(userId);
    if (email) seenEmails.add(email);
    try {
      let notificationId: Types.ObjectId | null = null;
      if (cfg.inApp && userId) {
        const stored = await storeInApp(input, userId, data, Boolean(email));
        if (stored.duplicate) continue; // this event already reached this recipient
        notificationId = stored.id;
      }
      if (email) {
        const message = template({
          clinicName: settings.name ?? 'MedAssist',
          timezone: settings.timezone,
          url,
          data,
          name: transactional ? (r.name ?? undefined) : undefined,
        });
        await enqueueEmail({
          message: { to: email, ...message },
          type: input.type,
          notificationId,
        });
      }
    } catch (err) {
      logger.error({ err: serializeError(err), type: input.type }, 'Notification failed');
    }
  }
}

let muted = false;

/**
 * Seed only: generating demo data (lab releases, critical values…) must not email or notify
 * anyone. Always reset it in a `finally`.
 */
export function setNotificationsMuted(value: boolean): void {
  muted = value;
}

/**
 * Sends a notification without blocking the caller; failures are logged, never thrown. Call it
 * after the transaction has committed. The returned promise (always resolves) is for tests.
 */
export function notify(input: NotifyInput): Promise<void> {
  if (muted) return Promise.resolve();
  return deliver(input).catch((err: unknown) =>
    logger.error({ err: serializeError(err), type: input.type }, 'Notification failed'),
  );
}

/**
 * Account emails (spec §11 "New staff account / password reset" – email only, never stored
 * in-app: the link is a one-time secret). Non-blocking; the response time of the caller does
 * not depend on whether the email goes out.
 */
export function notifyAccountCreated(
  user: { email: string; firstName?: string | null },
  token: string,
) {
  void notify({
    recipients: [{ email: user.email, name: user.firstName ?? null }],
    type: NOTIFICATION_TYPES.ACCOUNT_CREATED,
    title: 'Your MedAssist account',
    body: 'Set your password to start using MedAssist.',
    link: `/reset-password/${token}`,
  });
}

/** The password reset link (valid 30 minutes) – email only. */
export function notifyPasswordReset(user: { email: string }, token: string) {
  void notify({
    recipients: [{ email: user.email }],
    type: NOTIFICATION_TYPES.ACCOUNT_PASSWORD_RESET,
    title: 'Reset your MedAssist password',
    body: 'Use the link to set a new password.',
    link: `/reset-password/${token}`,
  });
}
