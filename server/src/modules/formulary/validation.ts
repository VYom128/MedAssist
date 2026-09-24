import { z } from 'zod';

/** GET /formulary?q=&limit= */
export const searchFormularySchema = {
  query: z.object({
    q: z.string().trim().min(1, 'Type at least one letter').max(50, 'At most 50 characters'),
    limit: z.coerce.number().int().min(1).max(25).default(10),
  }),
};

export type SearchFormularyQuery = z.infer<typeof searchFormularySchema.query>;
