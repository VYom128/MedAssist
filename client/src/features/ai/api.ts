import { apiSlice } from '../../app/apiSlice';
import type { ExplanationLanguage } from '../../constants/catalog';
import { toPaged, type ApiSuccess, type Paged } from '../../utils/http';

/**
 * AI features (spec §7.11–7.13, §9, Phase 9): clinical summaries of a note (doctors), plain-word
 * explanations (patients; doctors preview) and the admin AI monitor. Shapes mirror
 * server/src/modules/{summaries,explanations,aiInteractions}/serializer.ts.
 */

/** AI calls run synchronously on the server: up to two attempts per model, fallbacks after. */
export const AI_REQUEST_TIMEOUT_MS = 180_000;

export const SUMMARY_STATUSES = [
  'generating',
  'draft',
  'approved',
  'rejected',
  'failed',
  'superseded',
] as const;
export type SummaryStatus = (typeof SUMMARY_STATUSES)[number];

export interface SummaryDraft {
  oneLineSummary: string;
  presentingComplaint: string;
  keyFindings: string[];
  vitalsHighlights: string[];
  assessment: string;
  plan: string[];
  medications: string[];
  investigations: string[];
  followUp: string;
  flagsForClinician: string[];
}

interface Person {
  id: string;
  name: string | null;
}

export interface ClinicalSummary {
  id: string;
  encounterId: string;
  status: SummaryStatus;
  label: string;
  /** Send back as `expectedVersion` when editing or approving. */
  revision: number;
  encounterVersion: number;
  isOutdated: boolean;
  aiDraft: SummaryDraft | null;
  finalText: string | null;
  editedByDoctor: boolean;
  shareWithPatient: boolean;
  serverFlags: string[];
  promptVersion: string | null;
  model: string | null;
  isFallbackModel: boolean;
  errorCode: string | null;
  generatedBy: Person | null;
  generatedAt: string | null;
  reviewedBy: Person | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  supersededAt: string | null;
}

/** `GET /encounters/:id/summary`. */
export interface SummaryState {
  /** The open draft – the note's own doctor only. */
  draft: ClinicalSummary | null;
  approved: ClinicalSummary | null;
  /** The newest failed or rejected attempt, when newer than any draft. */
  lastAttempt: { id: string; status: SummaryStatus; errorCode: string | null } | null;
  isOutdated: boolean;
  noteSigned: boolean;
  /** AI summaries are on and this doctor may generate one. */
  aiEnabled: boolean;
}

export interface ExplanationMedicine {
  name: string;
  whatToDo: string;
  whenToTake: string;
  howLong: string;
  tips: string[];
}

export interface Explanation {
  id: string;
  sourceType: 'prescription' | 'follow_up_plan';
  sourceId: string;
  sourceVersion: number;
  language: ExplanationLanguage;
  label: string;
  content: {
    overview: string;
    medicines: ExplanationMedicine[];
    followUp: string;
    questionsToAskDoctor: string[];
    /** Fixed by the server, never written by the AI. */
    whenToContactClinic: string[];
  };
  /** Fixed by the server, never written by the AI. */
  disclaimer: string;
  /** The template was shown (the AI's answer failed the safety checks or the AI was down). */
  isFallback: boolean;
  fromCache: boolean;
  preview: boolean;
  generatedAt: string | null;
  feedback: { helpful: boolean; comment: string | null; at: string } | null;
  /** Doctors' preview only. */
  guardrailFlags?: string[];
}

export type ExplanationSource =
  { kind: 'prescription'; id: string } | { kind: 'follow_up_plan'; id: string };

export const AI_FEATURES = ['clinical_summary', 'patient_explanation'] as const;
export type AiFeature = (typeof AI_FEATURES)[number];
export const AI_INTERACTION_STATUSES = ['success', 'failed', 'blocked'] as const;
export type AiInteractionStatus = (typeof AI_INTERACTION_STATUSES)[number];

/** One AI attempt (`GET /ai/interactions`) – never prompts, inputs or outputs. */
export interface AiInteraction {
  id: string;
  callId: string;
  attempt: number;
  feature: AiFeature;
  status: AiInteractionStatus;
  provider: string;
  model: string | null;
  isFallbackModel: boolean;
  promptVersion: string;
  errorReason: string | null;
  guardrailFlags: string[];
  usage: { inputTokens: number; outputTokens: number };
  latencyMs: number;
  requestedByRole: string;
  sourceType: string | null;
  createdAt: string;
}

export interface AiInteractionParams {
  page?: number;
  limit?: number;
  feature?: AiFeature;
  status?: AiInteractionStatus;
  model?: string;
  from?: string;
  to?: string;
}

/** `GET /ai/interactions/summary`. Rates are 0…1. */
export interface AiInteractionSummary {
  range: { from: string; to: string };
  attempts: number;
  calls: number;
  failureRate: number;
  fallbackModelRate: number;
  templateFallbackRate: number;
  explanations: number;
  guardrailBlocks: number;
  guardrailFlags: { flag: string; count: number }[];
  tokens: { input: number; output: number };
  latency: { averageMs: number; p95Ms: number };
  feedback: { rated: number; helpful: number; helpfulPercent: number | null };
  perModel: { model: string; attempts: number; failed: number; blocked: number }[];
  perDay: { date: string; attempts: number; failed: number; blocked: number; tokens: number }[];
}

/** `GET /ai/config` – never the API key. */
export interface AiConfig {
  provider: string;
  baseUrlHost: string | null;
  model: string;
  fallbackModels: string[];
  timeoutMs: number;
  temperature: number;
  maxTokens: number;
  today: { calls: number; limit: number };
  enabled: {
    ai: boolean;
    clinicalSummary: boolean;
    patientExplanation: boolean;
    explanationLanguages: ExplanationLanguage[];
  };
}

const data = <T>(res: ApiSuccess<T>) => res.data;
const summaryTag = (encounterId: string) => ({ type: 'Summary' as const, id: encounterId });
const explainUrl = (s: ExplanationSource) =>
  s.kind === 'prescription'
    ? `/prescriptions/${s.id}/explain`
    : `/encounters/${s.id}/follow-up/explain`;

export const aiApi = apiSlice.injectEndpoints({
  endpoints: (build) => ({
    getSummary: build.query<SummaryState, string>({
      query: (encounterId) => ({ url: `/encounters/${encounterId}/summary` }),
      transformResponse: data<SummaryState>,
      providesTags: (_r, _e, encounterId) => [summaryTag(encounterId)],
    }),
    generateSummary: build.mutation<ClinicalSummary, string>({
      query: (encounterId) => ({
        url: `/encounters/${encounterId}/summary/generate`,
        method: 'POST',
        timeout: AI_REQUEST_TIMEOUT_MS,
      }),
      transformResponse: data<ClinicalSummary>,
      // Failures leave a `failed` attempt too, so refresh either way.
      invalidatesTags: (_r, _e, encounterId) => [summaryTag(encounterId), 'AiInteraction'],
    }),
    updateSummary: build.mutation<
      ClinicalSummary,
      { encounterId: string; summaryId: string; expectedVersion: number; finalText: string }
    >({
      query: ({ encounterId, summaryId, ...body }) => ({
        url: `/encounters/${encounterId}/summary/${summaryId}`,
        method: 'PATCH',
        data: body,
      }),
      transformResponse: data<ClinicalSummary>,
      invalidatesTags: (_r, _e, { encounterId }) => [summaryTag(encounterId)],
    }),
    approveSummary: build.mutation<
      ClinicalSummary,
      {
        encounterId: string;
        summaryId: string;
        shareWithPatient: boolean;
        expectedVersion?: number;
      }
    >({
      query: ({ encounterId, summaryId, ...body }) => ({
        url: `/encounters/${encounterId}/summary/${summaryId}/approve`,
        method: 'POST',
        data: body,
      }),
      transformResponse: data<ClinicalSummary>,
      invalidatesTags: (_r, _e, { encounterId }) => [summaryTag(encounterId), 'Timeline', 'Visit'],
    }),
    rejectSummary: build.mutation<
      ClinicalSummary,
      { encounterId: string; summaryId: string; reason: string }
    >({
      query: ({ encounterId, summaryId, reason }) => ({
        url: `/encounters/${encounterId}/summary/${summaryId}/reject`,
        method: 'POST',
        data: { reason },
      }),
      transformResponse: data<ClinicalSummary>,
      invalidatesTags: (_r, _e, { encounterId }) => [summaryTag(encounterId)],
    }),

    /**
     * A POST, but read like a query: the server answers from its cache when it can (free), and
     * each language is its own cache entry here, so switching back is instant.
     */
    explain: build.query<Explanation, { source: ExplanationSource; language: ExplanationLanguage }>(
      {
        query: ({ source, language }) => ({
          url: explainUrl(source),
          method: 'POST',
          data: { language },
          timeout: AI_REQUEST_TIMEOUT_MS,
        }),
        transformResponse: data<Explanation>,
        providesTags: (_r, _e, { source, language }) => [
          { type: 'Explanation', id: `${source.kind}:${source.id}:${language}` },
        ],
        keepUnusedDataFor: 600,
      },
    ),
    explanationFeedback: build.mutation<
      Explanation,
      { prescriptionId: string; language: ExplanationLanguage; helpful: boolean; comment?: string }
    >({
      query: ({ prescriptionId, ...body }) => ({
        url: `/prescriptions/${prescriptionId}/explain/feedback`,
        method: 'POST',
        data: body,
      }),
      transformResponse: data<Explanation>,
      // Keep the explanation on screen: patch the cached answer instead of asking again.
      async onQueryStarted({ prescriptionId, language }, { dispatch, queryFulfilled }) {
        try {
          const { data: updated } = await queryFulfilled;
          dispatch(
            aiApi.util.updateQueryData(
              'explain',
              { source: { kind: 'prescription', id: prescriptionId }, language },
              (draft) => {
                draft.feedback = updated.feedback;
              },
            ),
          );
        } catch {
          // The form shows the error.
        }
      },
    }),

    listAiInteractions: build.query<Paged<AiInteraction>, AiInteractionParams>({
      query: (params) => ({ url: '/ai/interactions', params }),
      transformResponse: toPaged<AiInteraction>,
      providesTags: ['AiInteraction'],
    }),
    getAiInteractionSummary: build.query<AiInteractionSummary, { from?: string; to?: string }>({
      query: (params) => ({ url: '/ai/interactions/summary', params }),
      transformResponse: data<AiInteractionSummary>,
      providesTags: ['AiInteraction'],
    }),
    getAiConfig: build.query<AiConfig, void>({
      query: () => ({ url: '/ai/config' }),
      transformResponse: data<AiConfig>,
      providesTags: ['AiInteraction', 'Settings'],
    }),
  }),
});

export const {
  useGetSummaryQuery,
  useGenerateSummaryMutation,
  useUpdateSummaryMutation,
  useApproveSummaryMutation,
  useRejectSummaryMutation,
  useExplainQuery,
  useExplanationFeedbackMutation,
  useListAiInteractionsQuery,
  useGetAiInteractionSummaryQuery,
  useGetAiConfigQuery,
} = aiApi;
