import mongoose, {
  Schema,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
} from 'mongoose';
import { PATIENT_LINK_STATUSES, ROLE_VALUES } from '../../config/constants.js';

const { ObjectId } = Schema.Types;

const passwordResetSchema = new Schema(
  {
    tokenHash: { type: String, required: true }, // SHA-256 of the emailed token
    expiresAt: { type: Date, required: true },
  },
  { _id: false },
);

/**
 * Login account for every role (spec §6.3). Adds `lastFailedLoginAt` for the 15-minute lockout
 * window (§5.8). `passwordHash` and `passwordReset` are never selected unless asked for.
 */
const userSchema = new Schema(
  {
    firstName: { type: String, required: true, trim: true, maxlength: 50 },
    lastName: { type: String, required: true, trim: true, maxlength: 50 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, trim: true, index: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLE_VALUES, required: true },
    isActive: { type: Boolean, default: true },
    mustChangePassword: { type: Boolean, default: false },
    emailVerifiedAt: Date,
    lastLoginAt: Date,
    failedLoginAttempts: { type: Number, default: 0 },
    lastFailedLoginAt: Date,
    lockUntil: Date,
    passwordChangedAt: Date, // access tokens issued before this second are rejected
    passwordReset: { type: passwordResetSchema, select: false },
    patient: { type: ObjectId, ref: 'Patient' }, // role=patient only; linked from Phase 3
    patientLinkStatus: { type: String, enum: PATIENT_LINK_STATUSES },
    avatarUrl: String,
    createdBy: { type: ObjectId, ref: 'User' },
    updatedBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

userSchema.index({ role: 1, isActive: 1 });
userSchema.index(
  { patient: 1 },
  { unique: true, partialFilterExpression: { patient: { $type: 'objectId' } } },
);
userSchema.index(
  { 'passwordReset.tokenHash': 1 },
  { partialFilterExpression: { 'passwordReset.tokenHash': { $type: 'string' } } },
);

export type UserDoc = InferSchemaType<typeof userSchema>;
export type UserDocument = HydratedDocument<UserDoc>;

export const User: Model<UserDoc> =
  (mongoose.models.User as Model<UserDoc> | undefined) ??
  mongoose.model<UserDoc>('User', userSchema);
