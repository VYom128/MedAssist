import mongoose, { Schema, type InferSchemaType } from 'mongoose';
import {
  NOTIFICATION_PRIORITIES,
  NOTIFICATION_RULES,
  NOTIFICATION_TYPE_VALUES,
} from '../../config/constants.js';

const { ObjectId } = Schema.Types;

/**
 * An in-app notification (spec §6.24, §11, Phase 10): one per recipient. Titles, bodies and
 * `data` never carry clinical details (§10.3) – `data` holds ids, numbers and statuses only
 * (checked by notification.service). `dedupeKey` (unique, sparse) makes a notification for the
 * same event and recipient happen once, however often a job or retry asks. Records expire after
 * 180 days.
 */
const notificationSchema = new Schema(
  {
    recipient: { type: ObjectId, ref: 'User', required: true, immutable: true },
    type: { type: String, enum: NOTIFICATION_TYPE_VALUES, required: true, immutable: true },
    priority: { type: String, enum: NOTIFICATION_PRIORITIES, default: 'normal', immutable: true },
    title: { type: String, required: true, trim: true, maxlength: NOTIFICATION_RULES.titleMax },
    body: { type: String, trim: true, maxlength: NOTIFICATION_RULES.bodyMax, default: '' },
    /** Client route ('/patient/invoices/…'). */
    link: { type: String, trim: true, maxlength: 300 },
    data: { type: Schema.Types.Mixed, default: undefined },
    readAt: { type: Date, default: null },
    /** `<event key>:<recipient id>` – one notification per event and recipient. */
    dedupeKey: { type: String, trim: true, maxlength: 200, immutable: true },
    channels: {
      inApp: { type: Boolean, default: true },
      email: {
        /** Whether an email was queued for this notification at all. */
        queued: { type: Boolean, default: false },
        sent: { type: Boolean, default: false },
        at: Date,
        attempts: { type: Number, default: 0 },
        /** The last failure (error name/code only – never the message body). */
        error: { type: String, trim: true, maxlength: 200 },
      },
    },
  },
  { timestamps: true, collection: 'notifications' },
);

notificationSchema.index({ recipient: 1, readAt: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, createdAt: -1, _id: -1 });
notificationSchema.index({ dedupeKey: 1 }, { unique: true, sparse: true });
notificationSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: NOTIFICATION_RULES.ttlDays * 24 * 60 * 60 },
);

export type NotificationDoc = InferSchemaType<typeof notificationSchema>;
const createModel = () => mongoose.model('Notification', notificationSchema);
type NotificationModel = ReturnType<typeof createModel>;
/** Reuses the compiled model when the module is evaluated again (vi.resetModules in tests). */
export const Notification =
  (mongoose.models.Notification as NotificationModel | undefined) ?? createModel();
