import { z } from 'zod';
import { ALLERGY_SEVERITIES } from '../../constants/catalog';

/** Clinical profile form (PATCH /patients/:id/clinical-profile; mirrors the server rules). */
export const clinicalProfileSchema = z.object({
  allergies: z
    .array(
      z.object({
        id: z.string().optional(),
        substance: z.string().trim().min(1, 'Required').max(100, 'At most 100 characters'),
        reaction: z.string().trim().max(200, 'At most 200 characters'),
        severity: z.enum(ALLERGY_SEVERITIES),
      }),
    )
    .max(50),
  chronicConditions: z
    .array(
      z.object({
        id: z.string().optional(),
        name: z.string().trim().min(1, 'Required').max(120, 'At most 120 characters'),
        since: z.string(),
        notes: z.string().trim().max(500, 'At most 500 characters'),
      }),
    )
    .max(50),
});
export type ClinicalProfileForm = z.infer<typeof clinicalProfileSchema>;
