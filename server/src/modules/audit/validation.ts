import { z } from 'zod';
import { AUDIT_OUTCOMES } from '../../config/constants.js';
import { objectId } from '../../utils/zod.js';

/** GET /audit-logs (spec §7.18). `from`/`to` are ISO date-times (clinic timezone arrives in Phase 2). */
export const listAuditLogsSchema = {
  query: z
    .object({
      page: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().positive().max(100).optional(),
      actor: objectId.optional(),
      // Prefix match: "auth." (all auth actions), "auth.login" (also matches auth.login_failed).
      action: z
        .string()
        .trim()
        .regex(/^[a-z_]+(\.[a-z_]*)?$/, 'Must look like "auth." or "auth.login"')
        .optional(),
      resourceType: z.string().trim().max(50).optional(),
      patient: objectId.optional(),
      outcome: z.enum(AUDIT_OUTCOMES).optional(),
      from: z.iso.datetime({ offset: true }).pipe(z.coerce.date()).optional(),
      to: z.iso.datetime({ offset: true }).pipe(z.coerce.date()).optional(),
    })
    .refine((q) => !q.from || !q.to || q.from <= q.to, {
      message: 'from must be before to',
      path: ['from'],
    }),
};

export type AuditLogQuery = z.infer<typeof listAuditLogsSchema.query>;
