import type { Types } from 'mongoose';
import type { ClinicalSummaryDoc } from './model.js';

/**
 * Clinical summary views (spec §7.11). Doctors only: the patient never gets this shape (an
 * approved, shared summary reaches the patient through the timeline).
 */

interface UserRef {
  _id: Types.ObjectId;
  firstName?: string;
  lastName?: string;
}

export type SummaryLike = Omit<ClinicalSummaryDoc, 'generatedBy' | 'reviewedBy'> & {
  _id: Types.ObjectId;
  __v?: number;
  generatedBy?: UserRef | Types.ObjectId | null;
  reviewedBy?: UserRef | Types.ObjectId | null;
  createdAt?: Date;
  updatedAt?: Date;
};

export const SUMMARY_POPULATE = [
  { path: 'generatedBy', select: 'firstName lastName' },
  { path: 'reviewedBy', select: 'firstName lastName' },
] as const;

/** The label every unreviewed AI draft carries (spec §9.2 UI rules). */
export const DRAFT_LABEL = 'AI draft – review before use';

const orNull = <T>(v: T | null | undefined): T | null => v ?? null;

function person(ref: SummaryLike['generatedBy']) {
  if (!ref) return null;
  if (!('firstName' in ref) || !ref.firstName) return { id: ref._id.toString(), name: null };
  return { id: ref._id.toString(), name: `Dr ${ref.firstName} ${ref.lastName ?? ''}`.trim() };
}

export function toDoctorView(s: SummaryLike, state: { isOutdated: boolean }) {
  const d = s.aiDraft;
  return {
    id: s._id.toString(),
    encounterId: s.encounter.toString(),
    status: s.status,
    label: s.status === 'approved' ? 'AI-assisted · reviewed' : DRAFT_LABEL,
    /** Send back as `expectedVersion` when editing. */
    revision: s.__v ?? 0,
    encounterVersion: s.encounterVersion,
    isOutdated: state.isOutdated,
    aiDraft: d
      ? {
          oneLineSummary: d.oneLineSummary ?? '',
          presentingComplaint: d.presentingComplaint ?? '',
          keyFindings: d.keyFindings ?? [],
          vitalsHighlights: d.vitalsHighlights ?? [],
          assessment: d.assessment ?? '',
          plan: d.plan ?? [],
          medications: d.medications ?? [],
          investigations: d.investigations ?? [],
          followUp: d.followUp ?? '',
          flagsForClinician: d.flagsForClinician ?? [],
        }
      : null,
    finalText: orNull(s.finalText),
    editedByDoctor: Boolean(s.editedByDoctor),
    shareWithPatient: Boolean(s.shareWithPatient),
    serverFlags: s.serverFlags ?? [],
    promptVersion: orNull(s.promptVersion),
    model: orNull(s.model),
    isFallbackModel: Boolean(s.isFallbackModel),
    errorCode: orNull(s.errorCode),
    generatedBy: person(s.generatedBy),
    generatedAt: orNull(s.generatedAt),
    reviewedBy: person(s.reviewedBy),
    reviewedAt: orNull(s.reviewedAt),
    rejectionReason: orNull(s.rejectionReason),
    supersededAt: orNull(s.supersededAt),
  };
}
