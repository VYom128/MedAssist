import mongoose, { Schema, type InferSchemaType } from 'mongoose';

const { ObjectId } = Schema.Types;

const sessionSchema = new Schema(
  {
    start: { type: String, required: true }, // 'HH:mm' in the clinic timezone
    end: { type: String, required: true },
    maxWalkIns: { type: Number, min: 0, default: 0 },
  },
  { _id: false },
);

/**
 * One weekday of a doctor's weekly template (spec §6.9). A **version** is the 7 documents (one per
 * weekday, `sessions: []` = day off) sharing `effectiveFrom`. `effectiveFrom` / `effectiveTo` are
 * clinic calendar dates stored at UTC midnight (utils/dates `calendarDate`); `effectiveTo` is
 * inclusive, null = open-ended. Saving a new version closes the previous one the day before.
 */
const doctorScheduleSchema = new Schema(
  {
    doctor: { type: ObjectId, ref: 'User', required: true }, // the doctor's User id
    weekday: { type: Number, required: true, min: 0, max: 6 }, // 0 = Sunday
    sessions: { type: [sessionSchema], default: [] },
    effectiveFrom: { type: Date, required: true },
    effectiveTo: { type: Date, default: null },
    createdBy: { type: ObjectId, ref: 'User' },
    updatedBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'doctor_schedules' },
);

doctorScheduleSchema.index({ doctor: 1, weekday: 1, effectiveFrom: 1 }, { unique: true });
doctorScheduleSchema.index({ doctor: 1, effectiveTo: 1 });

export type DoctorScheduleDoc = InferSchemaType<typeof doctorScheduleSchema>;

const createModel = () => mongoose.model('DoctorSchedule', doctorScheduleSchema);
export type DoctorScheduleModel = ReturnType<typeof createModel>;

export const DoctorSchedule: DoctorScheduleModel =
  (mongoose.models.DoctorSchedule as DoctorScheduleModel | undefined) ?? createModel();
