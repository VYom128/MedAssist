import type { Types } from 'mongoose';
import { runExplanation } from '../../ai/explanation.js';
import { assertAiQuota } from '../../ai/guards.js';
import type { ExplanationInput } from '../../ai/prompts/patientExplanation.v1.js';
import {
  AI_RULES,
  AUDIT_ACTIONS,
  ROLES,
  type ExplanationLanguage,
  type ExplanationSourceType,
} from '../../config/constants.js';
import { EXPLANATION_DISCLAIMER, WHEN_TO_CONTACT_CLINIC } from '../../data/safetyNet.js';
import { assertCanReadEncounter } from '../../policies/encounterAccess.js';
import { assertExplanationAllowed } from '../../policies/explanationAccess.js';
import { assertCanReadPrescription, ISSUED_STATUSES } from '../../policies/prescriptionAccess.js';
import * as audit from '../../services/audit.service.js';
import type { AuthUser } from '../../types/express.js';
import { ApiError } from '../../utils/ApiError.js';
import { actorOf, type RequestMeta } from '../../utils/requestContext.js';
import { loadEncounter } from '../encounters/service.js';
import { resolveMyPatientId } from '../patients/portal.service.js';
import { Prescription } from '../prescriptions/model.js';
import { loadPrescription } from '../prescriptions/service.js';
import { buildFollowUpInput, buildPrescriptionInput } from './input.js';
import { PatientExplanation } from './model.js';
import { toView, type ExplanationLike } from './serializer.js';
import type { ExplainInput, ExplanationFeedbackInput } from './validation.js';

/**
 * Patient explanations (spec §4.12, §9.3): "Explain in simple words" for the patient's own
 * issued prescriptions and signed follow-up plans; doctors who may read the record get a preview
 * (never cached for the patient). Order: access (404 for others) → AI flags, language and consent
 * (403 AI_DISABLED) → the cache (no AI call, no limits) → rate limit (10/hour per user) → daily
 * budget and the model chain (ai.service) → guardrails → saved. The disclaimer and the
 * when-to-contact list are added here from fixed lists, never by the model.
 *
 * Audit entries carry the source, language, outcome and flags – never the text.
 */

interface Source {
  type: ExplanationSourceType;
  id: Types.ObjectId;
  version: number;
  patientId: Types.ObjectId;
  build: (language: ExplanationLanguage) => Promise<ExplanationInput>;
  audit: { type: string; id: Types.ObjectId; number?: string };
}

const isPatient = (user: AuthUser) => user.role === ROLES.PATIENT;

/** A reissued prescription is a new version (1 = the first, +1 per reissue it replaces). */
async function reissueGeneration(rx: { replaces?: Types.ObjectId | null }): Promise<number> {
  let version = 1;
  let previous = rx.replaces ?? null;
  for (let i = 0; previous && i < 50; i += 1) {
    version += 1;
    const p = await Prescription.findById(previous).select('replaces').lean();
    previous = p?.replaces ?? null;
  }
  return version;
}

async function prescriptionSource(user: AuthUser, id: string, meta: RequestMeta): Promise<Source> {
  if (isPatient(user)) await resolveMyPatientId(user);
  const rx = await loadPrescription(id);
  await assertCanReadPrescription(user, rx, meta);
  if (!(ISSUED_STATUSES as readonly string[]).includes(rx.status)) {
    throw ApiError.unprocessable('Only an issued prescription can be explained', {
      status: rx.status,
    });
  }
  return {
    type: 'prescription',
    id: rx._id,
    version: await reissueGeneration(rx),
    patientId: rx.patient._id,
    build: (language) => buildPrescriptionInput(rx, language),
    audit: { type: 'prescription', id: rx._id, number: rx.prescriptionNumber ?? undefined },
  };
}

async function followUpSource(user: AuthUser, id: string, meta: RequestMeta): Promise<Source> {
  if (isPatient(user)) await resolveMyPatientId(user);
  const e = await loadEncounter(id);
  await assertCanReadEncounter(user, e, meta);
  if (e.status === 'draft') {
    throw ApiError.unprocessable('Only the follow-up plan of a signed note can be explained');
  }
  if (!e.followUp?.required) {
    throw ApiError.unprocessable('This visit has no follow-up plan to explain');
  }
  return {
    type: 'follow_up_plan',
    id: e._id,
    version: e.version,
    patientId: e.patient._id,
    build: (language) => buildFollowUpInput(e, language),
    audit: { type: 'encounter', id: e._id, number: e.encounterNumber },
  };
}

const cacheKey = (s: Source, language: ExplanationLanguage) => ({
  sourceType: s.type,
  sourceId: s.id,
  sourceVersion: s.version,
  language,
  cached: true,
});

async function explain(
  user: AuthUser,
  s: Source,
  language: ExplanationLanguage,
  meta: RequestMeta,
) {
  await assertExplanationAllowed(s.patientId, language);
  const forDoctor = !isPatient(user);
  const auditBase = {
    actor: actorOf(user),
    resource: s.audit,
    patient: s.patientId,
    request: meta,
  };

  // The cache first: free (no AI call, no rate limit, no budget).
  const cached = await PatientExplanation.findOne(cacheKey(s, language)).lean<ExplanationLike>();
  if (cached) {
    await audit.recordRead({
      ...auditBase,
      action: AUDIT_ACTIONS.EXPLANATION_VIEW,
      metadata: { sourceType: s.type, language, cached: true },
    });
    return toView(cached, { fromCache: true, forDoctor });
  }

  await assertAiQuota('patient_explanation', user.id, AI_RULES.explanationsPerHour, 3_600_000);
  const input = await s.build(language);
  const run = await runExplanation(input, {
    user,
    patient: s.patientId,
    source: { type: s.type, id: s.id, version: s.version },
    meta,
  });

  const doc = {
    sourceType: s.type,
    sourceId: s.id,
    sourceVersion: s.version,
    patient: s.patientId,
    language,
    content: { ...run.content, whenToContactClinic: [...WHEN_TO_CONTACT_CLINIC[language]] },
    disclaimer: EXPLANATION_DISCLAIMER[language],
    guardrailFlags: run.flags,
    isFallback: run.isFallback,
    outcome: run.outcome,
    cached: !forDoctor && run.cacheable,
    preview: forDoctor,
    requestedBy: user.id,
    promptVersion: run.promptVersion,
    model: run.model ?? undefined,
    aiInteraction: run.interactionId ?? undefined,
    callId: run.callId ?? undefined,
  };
  let saved: ExplanationLike;
  try {
    saved = (await PatientExplanation.create(doc)).toObject() as ExplanationLike;
  } catch (err) {
    // Two parallel requests: the other one cached it first – show that one.
    if ((err as { code?: number }).code !== 11000) throw err;
    const other = await PatientExplanation.findOne(cacheKey(s, language)).lean<ExplanationLike>();
    if (!other) throw err;
    return toView(other, { fromCache: true, forDoctor });
  }

  await audit.record({
    ...auditBase,
    action:
      run.outcome === 'blocked'
        ? AUDIT_ACTIONS.EXPLANATION_BLOCKED
        : AUDIT_ACTIONS.EXPLANATION_GENERATE,
    metadata: {
      explanationId: saved._id.toString(),
      sourceType: s.type,
      sourceVersion: s.version,
      language,
      outcome: run.outcome,
      isFallback: run.isFallback,
      preview: forDoctor,
      cached: doc.cached,
      flags: run.flags,
      model: run.model,
    },
  });
  return toView(saved, { fromCache: false, forDoctor });
}

/** POST /prescriptions/:id/explain – the patient's own issued prescription; doctors preview. */
export async function explainPrescription(
  user: AuthUser,
  id: string,
  input: ExplainInput,
  meta: RequestMeta,
) {
  return explain(user, await prescriptionSource(user, id, meta), input.language, meta);
}

/** POST /encounters/:id/follow-up/explain – the follow-up plan of a signed note. */
export async function explainFollowUp(
  user: AuthUser,
  id: string,
  input: ExplainInput,
  meta: RequestMeta,
) {
  return explain(user, await followUpSource(user, id, meta), input.language, meta);
}

/**
 * POST /prescriptions/:id/explain/feedback – the patient rates the cached explanation of the
 * current version in that language ("Was this helpful?"). 404 when there is none.
 */
export async function prescriptionFeedback(
  user: AuthUser,
  id: string,
  input: ExplanationFeedbackInput,
  meta: RequestMeta,
) {
  const s = await prescriptionSource(user, id, meta);
  const saved = await PatientExplanation.findOneAndUpdate(
    cacheKey(s, input.language),
    {
      $set: {
        feedback: {
          helpful: input.helpful,
          comment: input.comment || undefined,
          at: new Date(),
          by: user.id,
        },
      },
    },
    { new: true },
  ).lean<ExplanationLike>();
  if (!saved) throw ApiError.notFound('No explanation to rate yet');
  await audit.record({
    action: AUDIT_ACTIONS.EXPLANATION_FEEDBACK,
    actor: actorOf(user),
    resource: s.audit,
    patient: s.patientId,
    request: meta,
    // The comment stays on the explanation; the audit entry only says whether there was one.
    metadata: {
      explanationId: saved._id.toString(),
      language: input.language,
      helpful: input.helpful,
      commentGiven: Boolean(input.comment),
    },
  });
  return toView(saved, { fromCache: true, forDoctor: false });
}
