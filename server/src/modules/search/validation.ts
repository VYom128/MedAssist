import { z } from 'zod';
import { SEARCH_RULES } from '../../config/constants.js';

/** GET /search?q= (spec §12.1): at least 2 characters (400 VALIDATION_ERROR otherwise). */
export const searchSchema = {
  query: z.object({
    q: z
      .string()
      .trim()
      .min(SEARCH_RULES.minLength, `Type at least ${SEARCH_RULES.minLength} characters`)
      .max(SEARCH_RULES.maxLength, `At most ${SEARCH_RULES.maxLength} characters`),
  }),
};

export type SearchQuery = z.infer<typeof searchSchema.query>;
