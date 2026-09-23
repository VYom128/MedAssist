import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';
import { AUDIT_OUTCOMES } from '../../config/constants.js';
import { applyAppendOnly } from '../../utils/appendOnly.js';

const { ObjectId, Mixed } = Schema.Types;

/**
 * Append-only audit trail (spec §6.25, §10.4–10.5). Written only by services/audit.service.ts,
 * which assigns `seq` and the HMAC hash chain. `seq` (not in §6.25) gives the chain a total order.
 */
const auditLogSchema = new Schema(
  {
    seq: { type: Number, required: true, unique: true },
    at: { type: Date, required: true, index: true },
    actor: {
      user: { type: ObjectId, ref: 'User', default: null }, // null = system job or anonymous
      role: { type: String, default: null },
      name: { type: String, default: null },
    },
    action: { type: String, required: true, index: true },
    resource: {
      type: { type: String },
      id: { type: ObjectId },
      number: { type: String },
    },
    patient: { type: ObjectId, ref: 'Patient' },
    outcome: { type: String, enum: AUDIT_OUTCOMES, required: true, default: 'success' },
    request: {
      id: String,
      method: String,
      path: String,
      ip: String,
      userAgent: String,
    },
    changes: {
      // default: undefined stops Mongoose adding an empty array (keeps the hashed shape exact).
      fields: { type: [String], default: undefined },
      before: Mixed,
      after: Mixed,
    },
    metadata: Mixed,
    prevHash: { type: String, required: true },
    hash: { type: String, required: true },
  },
  { collection: 'audit_logs', versionKey: false },
);

auditLogSchema.index({ patient: 1, at: -1 });
auditLogSchema.index({ 'actor.user': 1, at: -1 });
auditLogSchema.index({ 'actor.user': 1, action: 1, 'resource.id': 1, at: -1 });

applyAppendOnly(auditLogSchema, 'Audit logs');

export type AuditLogDoc = InferSchemaType<typeof auditLogSchema>;

export const AuditLog: Model<AuditLogDoc> =
  (mongoose.models.AuditLog as Model<AuditLogDoc> | undefined) ??
  mongoose.model<AuditLogDoc>('AuditLog', auditLogSchema);
