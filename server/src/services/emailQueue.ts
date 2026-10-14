import type { Types } from 'mongoose';
import { NOTIFICATION_RULES } from '../config/constants.js';
import { config } from '../config/env.js';
import { Notification } from '../modules/notifications/model.js';
import { logger, serializeError } from '../utils/logger.js';
import { emailFailure, emailService, type EmailMessage } from './email.service.js';

/**
 * In-process email queue for notifications (spec §11): an email is tried once, then retried
 * `NOTIFICATION_RULES.emailRetries` times with backoff; the outcome is stored on the
 * notification (`channels.email { sent, at, attempts, error }`). Failures are logged (error name
 * and type only) and never thrown. Nothing survives a restart – acceptable for v1 (D-number in
 * §20); a durable queue can replace this module without touching callers.
 *
 * Tests: the queue runs inline (awaited by notify()) with no backoff waits, and sends through
 * `emailService.send`, which tests replace with a fake (`captureEmails()`).
 */

export interface EmailJob {
  message: EmailMessage;
  type: string;
  notificationId?: Types.ObjectId | null;
}

let inline = config.isTest;
let delays: readonly number[] = config.isTest ? [0, 0, 0] : NOTIFICATION_RULES.emailBackoffMs;
const pending = new Set<Promise<void>>();

/** Tests: run in the background like production, and/or with other backoff delays. */
export function configureEmailQueue(options: { inline?: boolean; delaysMs?: readonly number[] }) {
  if (options.inline !== undefined) inline = options.inline;
  if (options.delaysMs) delays = options.delaysMs;
}

const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

/** What may be stored about a failure: the error's name/code, never its message. */
function errorTag(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { code?: unknown; name?: unknown };
    if (typeof e.code === 'string') return e.code.slice(0, 60);
    if (typeof e.name === 'string') return e.name.slice(0, 60);
  }
  return 'Error';
}

async function record(job: EmailJob, update: Record<string, unknown>) {
  if (!job.notificationId) return;
  try {
    await Notification.updateOne({ _id: job.notificationId }, { $set: update });
  } catch (err) {
    logger.error({ err: serializeError(err) }, 'Could not record the email outcome');
  }
}

async function deliver(job: EmailJob): Promise<void> {
  const attempts = 1 + NOTIFICATION_RULES.emailRetries;
  let lastError = 'Error';
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await emailService.send(job.message);
      await record(job, {
        'channels.email.sent': true,
        'channels.email.at': new Date(),
        'channels.email.attempts': attempt,
        'channels.email.error': null,
      });
      return;
    } catch (err) {
      lastError = errorTag(err);
      if (attempt === attempts) {
        // Code and SMTP status only: messages can quote the recipient's address.
        logger.warn(
          { email: emailFailure(err), type: job.type, attempts },
          'Notification email failed',
        );
        break;
      }
      await sleep(delays[attempt - 1] ?? delays.at(-1) ?? 0);
    }
  }
  await record(job, {
    'channels.email.sent': false,
    'channels.email.attempts': attempts,
    'channels.email.error': lastError,
  });
}

/** Queues an email. Resolves at once in production; after delivery (or failure) in tests. */
export function enqueueEmail(job: EmailJob): Promise<void> {
  const run = deliver(job).catch((err: unknown) =>
    logger.error({ err: serializeError(err), type: job.type }, 'Email queue error'),
  );
  pending.add(run);
  void run.finally(() => pending.delete(run));
  return inline ? run : Promise.resolve();
}

/** Waits for every queued email (tests, graceful shutdown). */
export async function drainEmailQueue(): Promise<void> {
  while (pending.size > 0) await Promise.all([...pending]);
}
