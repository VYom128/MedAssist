import mongoose, { Schema, type InferSchemaType } from 'mongoose';

const { ObjectId } = Schema.Types;

/** Case-insensitive comparison for unique names ('Paediatrics' = 'paediatrics'). */
export const CASE_INSENSITIVE = { locale: 'en', strength: 2 } as const;

/** Clinic department (spec §6.6). Master data: deactivated, never deleted. */
const departmentSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    code: { type: String, required: true, trim: true, uppercase: true, unique: true },
    description: { type: String, trim: true, maxlength: 500 },
    isActive: { type: Boolean, default: true },
    createdBy: { type: ObjectId, ref: 'User' },
    updatedBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

departmentSchema.index({ name: 1 }, { unique: true, collation: CASE_INSENSITIVE });
departmentSchema.index({ isActive: 1, name: 1 });

export type DepartmentDoc = InferSchemaType<typeof departmentSchema>;

const createModel = () => mongoose.model('Department', departmentSchema);
export type DepartmentModel = ReturnType<typeof createModel>;

export const Department: DepartmentModel =
  (mongoose.models.Department as DepartmentModel | undefined) ?? createModel();
