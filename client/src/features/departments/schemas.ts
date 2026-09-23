import { z } from 'zod';

// Mirrors server/src/modules/departments/validation.ts.
export const departmentSchema = z.object({
  name: z.string().trim().min(2, 'At least 2 characters').max(80, 'At most 80 characters'),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2,10}$/, 'Use 2–10 letters (e.g. GEN)'),
  description: z.string().trim().max(500, 'At most 500 characters'),
});

export type DepartmentFormValues = z.infer<typeof departmentSchema>;
