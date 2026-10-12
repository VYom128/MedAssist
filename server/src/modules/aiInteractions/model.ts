import mongoose, { Schema, type InferSchemaType } from 'mongoose';
import {
  AI_FAILURE_REASONS,
  AI_FEATURES,
  AI_INTERACTION_STATUSES,
} from '../../config/constants.js';
import { applyAppendOnly } from '../../utils/appendOnly.js';

const { ObjectId } = Schema.Types;

/**
 * One AI provider attempt (spec §6.26, §9.1, Phase 9). An AI call can take several attempts – a
 * retry of invalid output, then each fallback model – that share a `callId`; every attempt is its
 * own row and counts toward the daily budget. Records who, for which record, which provider,
 * model and prompt version, the outcome, flags, token usage and latency. NEVER the prompt, the
 * input or the output – only a SHA-256 hash of the de-identified input. Append-only.
 */
const aiInteractionSchema = new Schema(
  {
    callId: { type: String, required: true, trim: true, maxlength: 40 },
    /** 1-based across the whole call (all models). Per-user rate limits count attempt 1 only. */
    attempt: { type: Number, required: true, min: 1, max: 20 },
    feature: { type: String, enum: AI_FEATURES, required: true },
    user: { type: ObjectId, ref: 'User' },
    patient: { type: ObjectId, ref: 'Patient' },
    source: {
      type: { type: String, trim: true, maxlength: 40 },
      id: ObjectId,
      version: Number,
    },
    provider: { type: String, required: true, trim: true, maxlength: 30 },
    /** The model actually called (and that answered, when it succeeded). */
    model: { type: String, trim: true, maxlength: 100 },
    /** A fallback model, not AI_MODEL. */
    isFallback: { type: Boolean, default: false },
    promptVersion: { type: String, required: true, trim: true, maxlength: 60 },
    inputHash: { type: String, required: true, match: /^[0-9a-f]{64}$/ },
    status: { type: String, enum: AI_INTERACTION_STATUSES, required: true },
    /** Why the attempt failed (a tag, never a message). */
    errorReason: { type: String, enum: AI_FAILURE_REASONS },
    guardrailFlags: { type: [String], default: [] },
    usage: {
      inputTokens: { type: Number, min: 0, default: 0 },
      outputTokens: { type: Number, min: 0, default: 0 },
    },
    latencyMs: { type: Number, min: 0, default: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'ai_interactions' },
);

aiInteractionSchema.index({ createdAt: -1 }); // daily budget, admin monitor
aiInteractionSchema.index({ callId: 1, attempt: 1 }, { unique: true });
aiInteractionSchema.index({ user: 1, feature: 1, attempt: 1, createdAt: -1 }); // rate limits

applyAppendOnly(aiInteractionSchema, 'AI interactions');

export type AiInteractionDoc = InferSchemaType<typeof aiInteractionSchema>;

const createModel = () => mongoose.model('AiInteraction', aiInteractionSchema);
export type AiInteractionModel = ReturnType<typeof createModel>;

export const AiInteraction: AiInteractionModel =
  (mongoose.models.AiInteraction as AiInteractionModel | undefined) ?? createModel();
