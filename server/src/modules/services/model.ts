import mongoose, { Schema, type InferSchemaType } from 'mongoose';
import { SERVICE_TYPES } from '../../config/constants.js';

const { ObjectId } = Schema.Types;

/**
 * Billable service (spec §6.7): consultation, procedure or other. Price in integer paise;
 * `taxRateBps` overrides the clinic default when set. Invoices snapshot name and price (Phase 7),
 * so edits never change existing invoices.
 */
const serviceSchema = new Schema(
  {
    code: { type: String, required: true, trim: true, uppercase: true, unique: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    department: { type: ObjectId, ref: 'Department', index: true },
    type: { type: String, enum: SERVICE_TYPES, required: true },
    durationMinutes: { type: Number, default: 15, min: 5, max: 240 },
    pricePaise: {
      type: Number,
      required: true,
      min: 0,
      validate: { validator: Number.isInteger, message: 'Must be a whole number of paise' },
    },
    taxRateBps: { type: Number, min: 0, max: 10_000, default: null },
    isActive: { type: Boolean, default: true },
    createdBy: { type: ObjectId, ref: 'User' },
    updatedBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

serviceSchema.index({ isActive: 1, type: 1, name: 1 });

export type ServiceDoc = InferSchemaType<typeof serviceSchema>;

const createModel = () => mongoose.model('Service', serviceSchema);
export type ServiceModel = ReturnType<typeof createModel>;

export const Service: ServiceModel =
  (mongoose.models.Service as ServiceModel | undefined) ?? createModel();
