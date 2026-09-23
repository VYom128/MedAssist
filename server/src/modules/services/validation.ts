import { z } from 'zod';
import { SERVICE_TYPES } from '../../config/constants.js';
import { booleanQuery, idParams, objectId, paginationQuery, paise } from '../../utils/zod.js';

/** Upper-case letters, digits and dashes, 2–20 characters ('CONS-GEN'). */
const code = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9-]{1,19}$/, 'Use 2–20 letters, digits or dashes');

const name = z.string().trim().min(2, 'At least 2 characters').max(120, 'At most 120 characters');
const durationMinutes = z
  .number()
  .int('Whole minutes')
  .min(5, 'At least 5')
  .max(240, 'At most 240');
/** 0–10000 basis points (0–100 %), or null to use the clinic default. */
const taxRateBps = z.number().int('Whole basis points').min(0).max(10_000).nullable();

export const listServicesSchema = {
  query: z.object({
    ...paginationQuery,
    department: objectId.optional(),
    type: z.enum(SERVICE_TYPES).optional(),
    q: z.string().trim().min(1).max(100).optional(),
    /** Admins only; ignored for everyone else. */
    includeInactive: booleanQuery,
    /** Admins only: only active (true) or only inactive (false) services. */
    isActive: booleanQuery,
  }),
};

export const createServiceSchema = {
  body: z.strictObject({
    code,
    name,
    department: objectId.nullable().optional(),
    type: z.enum(SERVICE_TYPES),
    durationMinutes: durationMinutes.optional(),
    pricePaise: paise,
    taxRateBps: taxRateBps.optional(),
  }),
};

export const updateServiceSchema = {
  params: idParams,
  body: z
    .strictObject({
      code: code.optional(),
      name: name.optional(),
      department: objectId.nullable().optional(),
      type: z.enum(SERVICE_TYPES).optional(),
      durationMinutes: durationMinutes.optional(),
      pricePaise: paise.optional(),
      taxRateBps: taxRateBps.optional(),
    })
    .refine((b) => Object.keys(b).length > 0, 'Nothing to update'),
};

export const serviceIdSchema = { params: idParams };

export type ListServicesQuery = z.infer<typeof listServicesSchema.query>;
export type CreateServiceInput = z.infer<typeof createServiceSchema.body>;
export type UpdateServiceInput = z.infer<typeof updateServiceSchema.body>;
