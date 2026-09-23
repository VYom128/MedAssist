import { z } from 'zod';
import { booleanQuery, idParams, optionalText, paginationQuery } from '../../utils/zod.js';

/** 2–10 letters, stored upper-case ('GEN'). */
export const departmentCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2,10}$/, 'Use 2–10 letters');

const name = z.string().trim().min(2, 'At least 2 characters').max(80, 'At most 80 characters');

export const listDepartmentsSchema = {
  query: z.object({
    ...paginationQuery,
    q: z.string().trim().min(1).max(100).optional(),
    /** Admins only; ignored for everyone else. */
    includeInactive: booleanQuery,
  }),
};

export const createDepartmentSchema = {
  body: z.strictObject({ name, code: departmentCode, description: optionalText(500) }),
};

export const updateDepartmentSchema = {
  params: idParams,
  body: z
    .strictObject({
      name: name.optional(),
      code: departmentCode.optional(),
      description: optionalText(500),
    })
    .refine((b) => Object.keys(b).length > 0, 'Nothing to update'),
};

export const departmentIdSchema = { params: idParams };

export type ListDepartmentsQuery = z.infer<typeof listDepartmentsSchema.query>;
export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema.body>;
export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema.body>;
