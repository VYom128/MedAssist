import mongoose, { Schema, type InferSchemaType } from 'mongoose';

const { ObjectId } = Schema.Types;

/**
 * Doctor profile (spec §6.8). One per doctor User; the rest of the app identifies a doctor by
 * the **User id** (`/doctors/:id`, `appointment.doctor`), never by this document's id.
 */
const doctorProfileSchema = new Schema(
  {
    user: { type: ObjectId, ref: 'User', required: true, unique: true },
    department: { type: ObjectId, ref: 'Department', required: true, index: true },
    specialization: { type: String, required: true, trim: true, maxlength: 100 },
    qualifications: { type: [String], default: [] }, // ['MBBS', 'MD (Medicine)']
    // Medical council registration; unique, so a duplicate fails inside the create transaction.
    registrationNumber: { type: String, required: true, trim: true, unique: true, maxlength: 50 },
    experienceYears: { type: Number, min: 0, max: 70 },
    consultationFeePaise: {
      type: Number,
      min: 0,
      validate: { validator: Number.isInteger, message: 'Must be a whole number of paise' },
    },
    slotMinutes: { type: Number, min: 5, max: 120 }, // overrides the clinic default
    roomNumber: { type: String, trim: true, maxlength: 20 },
    bio: { type: String, trim: true, maxlength: 1000 },
    languages: { type: [String], default: [] },
    isAcceptingAppointments: { type: Boolean, default: true },
    /**
     * Bumped inside schedule and leave transactions so two concurrent writes for the same doctor
     * conflict (one retries and re-checks overlaps) instead of both passing their checks.
     */
    lockVersion: { type: Number, default: 0 },
    createdBy: { type: ObjectId, ref: 'User' },
    updatedBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'doctor_profiles' },
);

doctorProfileSchema.index({ specialization: 1 });

export type DoctorProfileDoc = InferSchemaType<typeof doctorProfileSchema>;

const createModel = () => mongoose.model('DoctorProfile', doctorProfileSchema);
export type DoctorProfileModel = ReturnType<typeof createModel>;

export const DoctorProfile: DoctorProfileModel =
  (mongoose.models.DoctorProfile as DoctorProfileModel | undefined) ?? createModel();
