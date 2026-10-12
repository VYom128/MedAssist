import { z } from 'zod';

/**
 * What a notification's `data` may hold (spec §6.24 "small, NO clinical details"): ids, record
 * numbers, an appointment time or due date, a token/position/count and a status – nothing else.
 * Unknown keys or free-text values are rejected, so a drug name, result or diagnosis can never
 * slip into a notification (or the email built from it).
 */

const id = z.string().regex(/^[0-9a-f]{24}$/i);
/** 'APT-2026-000123', 'LAB-…', 'INV-…', 'FUR-…', 'PAY-…'. */
const recordNumber = z.string().regex(/^[A-Z]{2,5}-(?:\d{4}-)?\d{1,9}$/);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z)?$/);
const status = z.string().regex(/^[a-z_]{1,40}$/);
const count = z.number().int().min(0).max(1_000_000);

export const notificationDataSchema = z
  .object({
    appointmentId: id,
    appointmentNumber: recordNumber,
    startAt: isoDate,
    tokenNumber: count,
    position: count,
    encounterId: id,
    prescriptionId: id,
    labOrderId: id,
    orderNumber: recordNumber,
    invoiceId: id,
    invoiceNumber: recordNumber,
    paymentId: id,
    requestId: id,
    requestNumber: recordNumber,
    patientId: id,
    dueDate: isoDate,
    count,
    status,
  })
  .partial()
  .strict();

export type NotificationData = z.infer<typeof notificationDataSchema> & Record<string, unknown>;

/** The data when it passes the allow-list, else null (the caller logs and drops it). */
export function cleanNotificationData(data: unknown): NotificationData | null {
  if (data === undefined || data === null) return {};
  const parsed = notificationDataSchema.safeParse(data);
  return parsed.success ? (parsed.data as NotificationData) : null;
}
