import mongoose, { Schema, type InferSchemaType } from 'mongoose';
import {
  LAB_SAMPLE_TYPES,
  LAB_TEST_CATEGORIES,
  LAB_VALUE_TYPES,
  RANGE_GENDERS,
} from '../../config/constants.js';

const { ObjectId } = Schema.Types;

/**
 * Reference range for a numeric parameter. Ages are whole years, both ends inclusive; missing
 * ends are open. Flag computation from these ranges comes in Phase 6 (spec §8.7).
 */
const rangeSchema = new Schema(
  {
    gender: { type: String, enum: RANGE_GENDERS, default: 'any' },
    ageMinYears: Number,
    ageMaxYears: Number,
    low: Number,
    high: Number,
    criticalLow: Number,
    criticalHigh: Number,
    text: String, // shown as the reference, e.g. '< 200 desirable'
  },
  { _id: false },
);

const parameterSchema = new Schema(
  {
    key: { type: String, required: true }, // 'hb', unique within the test
    name: { type: String, required: true },
    unit: String,
    valueType: { type: String, enum: LAB_VALUE_TYPES, required: true },
    options: { type: [String], default: [] }, // valueType 'option'
    ranges: { type: [rangeSchema], default: [] }, // valueType 'number'
  },
  { _id: false },
);

/** Lab test catalogue entry (spec §6.19). Lab orders snapshot name and price (Phase 6). */
const labTestSchema = new Schema(
  {
    code: { type: String, required: true, trim: true, uppercase: true, unique: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    category: { type: String, enum: LAB_TEST_CATEGORIES, required: true },
    sampleType: { type: String, enum: LAB_SAMPLE_TYPES, required: true },
    pricePaise: {
      type: Number,
      required: true,
      min: 0,
      validate: { validator: Number.isInteger, message: 'Must be a whole number of paise' },
    },
    turnaroundHours: { type: Number, min: 1, max: 720 },
    preparation: { type: String, trim: true, maxlength: 300 },
    parameters: { type: [parameterSchema], default: [] },
    isActive: { type: Boolean, default: true },
    createdBy: { type: ObjectId, ref: 'User' },
    updatedBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'lab_tests' },
);

labTestSchema.index({ isActive: 1, category: 1, name: 1 });

export type LabTestDoc = InferSchemaType<typeof labTestSchema>;

const createModel = () => mongoose.model('LabTest', labTestSchema);
export type LabTestModel = ReturnType<typeof createModel>;

export const LabTest: LabTestModel =
  (mongoose.models.LabTest as LabTestModel | undefined) ?? createModel();
