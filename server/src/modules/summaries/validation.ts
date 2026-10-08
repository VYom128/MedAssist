import { z } from 'zod';
import { AI_RULES } from '../../config/constants.js';
import { idParams, objectId } from '../../utils/zod.js';

/** /encounters/:id/summary… (spec §7.11). */

const summaryParams = z.object({ id: objectId, summaryId: objectId });
const expectedVersion = z.number({ error: 'Send the revision you last loaded' }).int().min(0);

export const encounterSummarySchema = { params: idParams };

/** PATCH /encounters/:id/summary/:summaryId – the doctor's edit of the draft text. */
export const updateSummarySchema = {
  params: summaryParams,
  body: z.strictObject({
    expectedVersion,
    finalText: z
      .string()
      .trim()
      .min(1, 'The summary cannot be empty')
      .max(AI_RULES.finalTextMax, `At most ${AI_RULES.finalTextMax} characters`),
  }),
};

/** POST …/approve – share with the patient only when ticked (default false). */
export const approveSummarySchema = {
  params: summaryParams,
  body: z.strictObject({
    shareWithPatient: z.boolean().default(false),
    /** Optional: approve only the revision the doctor is looking at. */
    expectedVersion: expectedVersion.optional(),
  }),
};

/** POST …/reject – why (helps improve the prompts). */
export const rejectSummarySchema = {
  params: summaryParams,
  body: z.strictObject({
    reason: z
      .string()
      .trim()
      .min(AI_RULES.rejectionReasonMin, `At least ${AI_RULES.rejectionReasonMin} characters`)
      .max(AI_RULES.rejectionReasonMax, `At most ${AI_RULES.rejectionReasonMax} characters`),
  }),
};

export type UpdateSummaryInput = z.infer<typeof updateSummarySchema.body>;
export type ApproveSummaryInput = z.infer<typeof approveSummarySchema.body>;
export type RejectSummaryInput = z.infer<typeof rejectSummarySchema.body>;
