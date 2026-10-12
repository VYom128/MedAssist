import type { Types } from 'mongoose';
import { AiCallError, generateJson } from '../../ai/ai.service.js';
import { assertAiEnabled, assertAiQuota, isAiEnabled } from '../../ai/guards.js';
import {
  buildUserMessage,
  PROMPT_VERSION,
  SCHEMA_NAME,
  summaryOutputSchema,
  SYSTEM_PROMPT,
} from '../../ai/prompts/clinicalSummary.v1.js';
import { checkSummary, renderFinalText } from '../../ai/summary/checks.js';
import {
  AI_GUARDRAIL_FLAGS,
  AI_RULES,
  AUDIT_ACTIONS,
  ERROR_CODES,
} from '../../config/constants.js';
import { assertCanReadEncounter, assertCanWriteEncounter } from '../../policies/encounterAccess.js';
import * as audit from '../../services/audit.service.js';
import type { AuthUser } from '../../types/express.js';
import { ApiError } from '../../utils/ApiError.js';
import { actorOf, type RequestMeta } from '../../utils/requestContext.js';
import { assertTransition } from '../../utils/stateMachine.js';
import { withTransaction } from '../../utils/transaction.js';
import { loadEncounter } from '../encounters/service.js';
import type { EncounterLike } from '../encounters/serializer.js';
import { buildSummaryInput } from './input.js';
import { ClinicalSummary } from './model.js';
import { SUMMARY_POPULATE, toDoctorView, type SummaryLike } from './serializer.js';
import type { ApproveSummaryInput, RejectSummaryInput, UpdateSummaryInput } from './validation.js';

/**
 * AI clinical summaries (spec §4.11, §7.11, §9.2). Only the note's own doctor generates, edits,
 * approves or rejects (others 404 through the encounter policy); a doctor with a care
 * relationship reads the approved summary of a signed note. Generating works on a draft or a
 * signed note; approving needs the signed note at the version and content the summary was made
 * from. The AI never writes to the note. With AI turned off in settings the writes return 403
 * AI_DISABLED; stored summaries can still be read.
 *
 * Audit entries carry flags, models and field names – never the summary or note text.
 */

const SIGNED = ['signed', 'amended'];

const resourceOf = (s: { _id: Types.ObjectId }) => ({ type: 'clinical_summary', id: s._id });

async function loadSummary(e: EncounterLike, summaryId: string): Promise<SummaryLike> {
  const s = await ClinicalSummary.findOne({ _id: summaryId, encounter: e._id })
    .populate([...SUMMARY_POPULATE])
    .lean<SummaryLike>();
  if (!s) throw ApiError.notFound('Summary not found');
  return s;
}

/** Outdated = the note was amended, or its content changed, after the summary was generated. */
function isOutdated(s: SummaryLike, e: EncounterLike, currentHash: string): boolean {
  return s.encounterVersion !== e.version || s.inputHash !== currentHash;
}

async function view(e: EncounterLike, id: Types.ObjectId, currentHash?: string) {
  const s = await ClinicalSummary.findById(id)
    .populate([...SUMMARY_POPULATE])
    .lean<SummaryLike>();
  if (!s) throw ApiError.notFound('Summary not found');
  const hash = currentHash ?? (await buildSummaryInput(e)).inputHash;
  return toDoctorView(s, { isOutdated: isOutdated(s, e, hash) });
}

/** The note, for its own doctor only (404 + access.denied otherwise). */
async function ownNote(user: AuthUser, encounterId: string, meta: RequestMeta) {
  const e = await loadEncounter(encounterId);
  await assertCanWriteEncounter(user, e, meta);
  return e;
}

// ---- Generate --------------------------------------------------------------------------------

/**
 * POST /encounters/:id/summary/generate – synchronous (≤ AI_TIMEOUT_MS per attempt). A
 * `generating` row blocks a second parallel generation (409); the new draft supersedes the
 * previous draft. AI failures leave a `failed` row and return 503 (AI_UNAVAILABLE /
 * AI_OUTPUT_INVALID) – the doctor writes the summary by hand.
 */
export async function generateSummary(user: AuthUser, encounterId: string, meta: RequestMeta) {
  const e = await ownNote(user, encounterId, meta);
  await assertAiEnabled('clinical_summary');
  await assertAiQuota('clinical_summary', user.id, AI_RULES.summaryGenerationsPerMinute, 60_000);

  const { input, inputHash } = await buildSummaryInput(e);
  // A request that crashed mid-generation must not block the note for ever.
  await ClinicalSummary.updateMany(
    {
      encounter: e._id,
      status: 'generating',
      createdAt: { $lt: new Date(Date.now() - AI_RULES.generatingStaleMs) },
    },
    { $set: { status: 'failed', errorCode: ERROR_CODES.AI_UNAVAILABLE } },
  );
  let pending;
  try {
    pending = await ClinicalSummary.create({
      encounter: e._id,
      encounterVersion: e.version,
      inputHash,
      patient: e.patient._id,
      doctor: e.doctor._id,
      status: 'generating',
      promptVersion: PROMPT_VERSION,
      generatedBy: user.id,
    });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      throw ApiError.conflict('A summary is already being generated for this note');
    }
    throw err;
  }

  let result;
  try {
    result = await generateJson({
      feature: 'clinical_summary',
      promptVersion: PROMPT_VERSION,
      schemaName: SCHEMA_NAME,
      system: SYSTEM_PROMPT,
      input: input as unknown as Record<string, unknown>,
      userMessage: buildUserMessage(input),
      schema: summaryOutputSchema,
      user,
      patient: e.patient._id,
      source: { type: 'encounter', id: e._id, version: e.version },
      meta,
    });
  } catch (err) {
    const errorCode = err instanceof ApiError ? err.code : ERROR_CODES.INTERNAL_ERROR;
    assertTransition('clinicalSummary', 'generating', 'failed');
    await ClinicalSummary.updateOne(
      { _id: pending._id, status: 'generating' },
      {
        $set: {
          status: 'failed',
          errorCode,
          ...(err instanceof AiCallError ? { callId: err.callId } : {}),
        },
      },
    );
    await audit.record({
      action: AUDIT_ACTIONS.SUMMARY_GENERATE,
      outcome: 'failure',
      actor: actorOf(user),
      resource: resourceOf(pending),
      patient: e.patient._id,
      request: meta,
      metadata: { encounterId: e._id.toString(), errorCode },
    });
    throw err;
  }

  const checked = checkSummary(result.data, input);
  const flags = [...checked.flags];
  if (result.retried) flags.push(AI_GUARDRAIL_FLAGS.OUTPUT_RETRIED);
  if (result.isFallback) flags.push(AI_GUARDRAIL_FLAGS.FALLBACK_MODEL);

  assertTransition('clinicalSummary', 'generating', 'draft');
  const superseded = await withTransaction(async (session) => {
    const previous = await ClinicalSummary.find({
      encounter: e._id,
      status: 'draft',
      _id: { $ne: pending._id },
    })
      .select('_id')
      .session(session)
      .lean();
    if (previous.length) {
      assertTransition('clinicalSummary', 'draft', 'superseded');
      await ClinicalSummary.updateMany(
        { _id: { $in: previous.map((p) => p._id) }, status: 'draft' },
        { $set: { status: 'superseded', supersededAt: new Date() } },
        { session },
      );
    }
    const saved = await ClinicalSummary.updateOne(
      { _id: pending._id, status: 'generating' },
      {
        $set: {
          status: 'draft',
          aiDraft: checked.draft,
          finalText: renderFinalText(checked.draft),
          serverFlags: flags,
          model: result.model,
          isFallbackModel: result.isFallback,
          aiInteraction: result.interactionId ?? undefined,
          callId: result.callId,
          generatedAt: new Date(),
        },
      },
      { session },
    );
    if (saved.modifiedCount !== 1) throw ApiError.conflict('This summary was changed elsewhere');
    return previous.map((p) => p._id.toString());
  });

  await audit.record({
    action: AUDIT_ACTIONS.SUMMARY_GENERATE,
    actor: actorOf(user),
    resource: resourceOf(pending),
    patient: e.patient._id,
    request: meta,
    metadata: {
      encounterId: e._id.toString(),
      encounterVersion: e.version,
      promptVersion: PROMPT_VERSION,
      model: result.model,
      isFallbackModel: result.isFallback,
      attempts: result.attempts,
      flags,
      supersededSummaryIds: superseded,
    },
  });
  return view(e, pending._id, inputHash);
}

// ---- Read ------------------------------------------------------------------------------------

/**
 * GET /encounters/:id/summary – the latest draft (the note's own doctor only) and the current
 * approved summary (any doctor who may read the note), each with `isOutdated`. Audited
 * `summary.view` (debounced) when a summary is returned.
 */
export async function getSummary(user: AuthUser, encounterId: string, meta: RequestMeta) {
  const e = await loadEncounter(encounterId);
  await assertCanReadEncounter(user, e, meta);
  const own = e.doctor._id.toString() === user.id;
  const [approved, latest] = await Promise.all([
    ClinicalSummary.findOne({ encounter: e._id, status: 'approved' })
      .populate([...SUMMARY_POPULATE])
      .lean<SummaryLike>(),
    own
      ? ClinicalSummary.findOne({
          encounter: e._id,
          status: { $in: ['generating', 'draft', 'failed', 'rejected'] },
        })
          .sort({ createdAt: -1, _id: -1 })
          .populate([...SUMMARY_POPULATE])
          .lean<SummaryLike>()
      : null,
  ]);
  // Only an open draft is shown as "the draft"; a newer failure or rejection is reported too.
  const draft = latest && ['draft', 'generating'].includes(latest.status) ? latest : null;
  const last = latest && !draft ? latest : null;
  const { inputHash } = await buildSummaryInput(e);
  const shown = [draft, approved].filter((s): s is SummaryLike => s !== null);
  for (const s of shown) {
    await audit.recordRead({
      action: AUDIT_ACTIONS.SUMMARY_VIEW,
      actor: actorOf(user),
      resource: resourceOf(s),
      patient: e.patient._id,
      request: meta,
    });
  }
  const viewOf = (s: SummaryLike | null) =>
    s ? toDoctorView(s, { isOutdated: isOutdated(s, e, inputHash) }) : null;
  return {
    draft: viewOf(draft),
    approved: viewOf(approved),
    /** The newest failed or rejected attempt, when it is newer than any draft. */
    lastAttempt: last
      ? { id: last._id.toString(), status: last.status, errorCode: last.errorCode ?? null }
      : null,
    isOutdated: draft ? isOutdated(draft, e, inputHash) : false,
    noteSigned: SIGNED.includes(e.status),
    aiEnabled: own ? await isAiEnabled('clinical_summary') : false,
  };
}

// ---- Edit, approve, reject -------------------------------------------------------------------

function staleDraft(s: SummaryLike, expectedVersion: number | undefined) {
  if (s.status !== 'draft') {
    return ApiError.conflict('Only a draft summary can be changed', { status: s.status });
  }
  return ApiError.conflict('This summary was changed elsewhere – reload it', {
    currentRevision: s.__v ?? 0,
    expectedVersion,
  });
}

/** PATCH /encounters/:id/summary/:summaryId – the doctor's text (draft only). */
export async function updateSummary(
  user: AuthUser,
  encounterId: string,
  summaryId: string,
  input: UpdateSummaryInput,
  meta: RequestMeta,
) {
  const e = await ownNote(user, encounterId, meta);
  await assertAiEnabled('clinical_summary');
  const s = await loadSummary(e, summaryId);
  const updated = await ClinicalSummary.findOneAndUpdate(
    { _id: s._id, status: 'draft', __v: input.expectedVersion },
    { $set: { finalText: input.finalText, editedByDoctor: true }, $inc: { __v: 1 } },
    { new: true },
  ).lean();
  if (!updated) throw staleDraft(await loadSummary(e, summaryId), input.expectedVersion);
  await audit.recordDebounced({
    action: AUDIT_ACTIONS.SUMMARY_UPDATE,
    actor: actorOf(user),
    resource: resourceOf(s),
    patient: e.patient._id,
    request: meta,
    changes: { fields: ['finalText'] },
  });
  return view(e, s._id);
}

/**
 * POST /encounters/:id/summary/:summaryId/approve – the note must be signed (422
 * NOTE_NOT_SIGNED) and unchanged since the summary was generated (409 SUMMARY_OUTDATED). One
 * transaction: the previous approved summary becomes `superseded`, this one `approved`.
 */
export async function approveSummary(
  user: AuthUser,
  encounterId: string,
  summaryId: string,
  input: ApproveSummaryInput,
  meta: RequestMeta,
) {
  const e = await ownNote(user, encounterId, meta);
  await assertAiEnabled('clinical_summary');
  const s = await loadSummary(e, summaryId);
  assertTransition('clinicalSummary', s.status, 'approved');
  if (!SIGNED.includes(e.status)) {
    throw new ApiError(
      422,
      'Sign the note before approving its summary',
      ERROR_CODES.NOTE_NOT_SIGNED,
    );
  }
  const { inputHash } = await buildSummaryInput(e);
  if (isOutdated(s, e, inputHash)) {
    throw new ApiError(
      409,
      'The note changed after this summary was generated – generate a new one',
      ERROR_CODES.SUMMARY_OUTDATED,
      { encounterVersion: e.version, summaryEncounterVersion: s.encounterVersion },
    );
  }
  if (input.expectedVersion !== undefined && input.expectedVersion !== (s.__v ?? 0)) {
    throw staleDraft(s, input.expectedVersion);
  }
  if (!s.finalText?.trim()) throw ApiError.unprocessable('The summary text is empty');

  const now = new Date();
  let superseded: string | null = null;
  try {
    superseded = await withTransaction(async (session) => {
      const previous = await ClinicalSummary.findOneAndUpdate(
        { encounter: e._id, status: 'approved' },
        { $set: { status: 'superseded', supersededAt: now } },
        { session },
      ).lean();
      const approved = await ClinicalSummary.findOneAndUpdate(
        { _id: s._id, status: 'draft', __v: s.__v ?? 0 },
        {
          $set: {
            status: 'approved',
            shareWithPatient: input.shareWithPatient,
            reviewedBy: user.id,
            reviewedAt: now,
          },
          $inc: { __v: 1 },
        },
        { session },
      ).lean();
      if (!approved) throw ApiError.conflict('This summary was changed elsewhere – reload it');
      return previous ? previous._id.toString() : null;
    });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      throw ApiError.conflict('Another summary of this note was approved at the same time');
    }
    throw err;
  }
  await audit.record({
    action: AUDIT_ACTIONS.SUMMARY_APPROVE,
    actor: actorOf(user),
    resource: resourceOf(s),
    patient: e.patient._id,
    request: meta,
    metadata: {
      encounterId: e._id.toString(),
      encounterVersion: e.version,
      shareWithPatient: input.shareWithPatient,
      editedByDoctor: Boolean(s.editedByDoctor),
      supersededSummaryId: superseded,
    },
  });
  return view(e, s._id, inputHash);
}

/** POST /encounters/:id/summary/:summaryId/reject – a draft, with the doctor's reason. */
export async function rejectSummary(
  user: AuthUser,
  encounterId: string,
  summaryId: string,
  input: RejectSummaryInput,
  meta: RequestMeta,
) {
  const e = await ownNote(user, encounterId, meta);
  await assertAiEnabled('clinical_summary');
  const s = await loadSummary(e, summaryId);
  assertTransition('clinicalSummary', s.status, 'rejected');
  const rejected = await ClinicalSummary.findOneAndUpdate(
    { _id: s._id, status: 'draft' },
    {
      $set: {
        status: 'rejected',
        rejectionReason: input.reason,
        reviewedBy: user.id,
        reviewedAt: new Date(),
      },
      $inc: { __v: 1 },
    },
  ).lean();
  if (!rejected) throw staleDraft(await loadSummary(e, summaryId), undefined);
  await audit.record({
    action: AUDIT_ACTIONS.SUMMARY_REJECT,
    actor: actorOf(user),
    resource: resourceOf(s),
    patient: e.patient._id,
    request: meta,
    // The reason is stored on the summary; the audit entry says only that one was given.
    metadata: { encounterId: e._id.toString(), reasonLength: input.reason.length },
  });
  return view(e, s._id);
}
