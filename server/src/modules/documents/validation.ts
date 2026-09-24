import { z } from 'zod';
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_LINK_TYPES,
  DOCUMENT_RULES,
} from '../../config/constants.js';
import { dateOnly, idParams, objectId, paginationQuery } from '../../utils/zod.js';

/**
 * POST /documents – multipart text fields (all strings) next to `file`. `visibleToPatient` is
 * 'true'/'false' (forced true for patients' own uploads).
 */
export const uploadDocumentSchema = {
  body: z
    .strictObject({
      patientId: objectId,
      category: z.enum(DOCUMENT_CATEGORIES),
      title: z
        .string()
        .trim()
        .min(1, 'Required')
        .max(DOCUMENT_RULES.titleMax, `At most ${DOCUMENT_RULES.titleMax} characters`),
      linkedType: z.enum(DOCUMENT_LINK_TYPES).optional(),
      linkedId: objectId.optional(),
      visibleToPatient: z
        .enum(['true', 'false'])
        .transform((v) => v === 'true')
        .optional(),
    })
    .refine((b) => !b.linkedType === !b.linkedId, {
      path: ['linkedId'],
      message: 'Give both linkedType and linkedId, or neither',
    }),
};

/** GET /documents. */
export const listDocumentsSchema = {
  query: z
    .object({
      ...paginationQuery,
      patient: objectId.optional(),
      category: z.enum(DOCUMENT_CATEGORIES).optional(),
      linkedType: z.enum(DOCUMENT_LINK_TYPES).optional(),
      linkedId: objectId.optional(),
      /** Clinic dates of upload (inclusive). */
      from: dateOnly.optional(),
      to: dateOnly.optional(),
    })
    .refine((q) => !q.from || !q.to || q.from <= q.to, {
      path: ['to'],
      message: 'Must be on or after from',
    }),
};

export const documentIdSchema = { params: idParams };

/** POST /documents/:id/delete – soft delete with a reason. */
export const deleteDocumentSchema = {
  params: idParams,
  body: z.strictObject({
    reason: z
      .string()
      .trim()
      .min(
        DOCUMENT_RULES.deleteReasonMinLength,
        `At least ${DOCUMENT_RULES.deleteReasonMinLength} characters`,
      )
      .max(DOCUMENT_RULES.deleteReasonMaxLength),
  }),
};

export type UploadDocumentInput = z.infer<typeof uploadDocumentSchema.body>;
export type ListDocumentsQuery = z.infer<typeof listDocumentsSchema.query>;
