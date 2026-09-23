import mongoose, { Schema, type InferSchemaType } from 'mongoose';
import { PATIENT_LINK_STATUSES, ROLE_VALUES } from '../../config/constants.js';
import { verifyPassword } from '../../utils/password.js';

const { ObjectId } = Schema.Types;

/** Fields `toJSON` always removes. Responses use serializers; this is a second safety net. */
const HIDDEN_FIELDS = ['passwordHash', 'passwordReset', 'failedLoginAttempts', 'lockUntil'];

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
  {
    timestamps: true,
    virtuals: {
      fullName: {
        get(this: { firstName: string; lastName: string }) {
          return `${this.firstName} ${this.lastName}`;
        },
      },
    },
    methods: {
      /**
       * Compares a plain password with this user's hash. The document must have been loaded with
       * `.select('+passwordHash')`.
       */
      comparePassword(this: { passwordHash?: string }, plain: string): Promise<boolean> {
        if (!this.passwordHash) throw new Error('passwordHash not selected');
        return verifyPassword(plain, this.passwordHash);
      },
    },
    toJSON: {
      virtuals: true,
      versionKey: false,
      // Never serialise secrets or lockout state, even by accident (e.g. logging a document).
      transform(_doc, ret: Record<string, unknown>) {
        for (const key of HIDDEN_FIELDS) delete ret[key];
        return ret;
      },
    },
  },
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

const createModel = () => mongoose.model('User', userSchema);
export type UserModel = ReturnType<typeof createModel>;
export type UserDocument = InstanceType<UserModel>;

export const User: UserModel = (mongoose.models.User as UserModel | undefined) ?? createModel();
