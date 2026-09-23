import mongoose, { Schema, type InferSchemaType } from 'mongoose';

/**
 * Sequences for human-readable numbers (spec §6.27): `_id` is the sequence key ('mrn',
 * 'appointment:2026', …), `seq` the last number issued. Only services/counter.service.ts writes it.
 */
const counterSchema = new Schema(
  {
    _id: { type: String, required: true },
    seq: { type: Number, required: true, default: 0 },
  },
  { versionKey: false },
);

export type CounterDoc = InferSchemaType<typeof counterSchema>;

const createModel = () => mongoose.model('Counter', counterSchema);
export type CounterModel = ReturnType<typeof createModel>;

export const Counter: CounterModel =
  (mongoose.models.Counter as CounterModel | undefined) ?? createModel();
