import type {
  AiConfig,
  AiInteraction,
  AiInteractionSummary,
  ClinicalSummary,
  Explanation,
  SummaryState,
} from '../src/features/ai/api';

/** Phase 9 AI shapes (server summaries / explanations / aiInteractions serializers). */

export function summary(over: Partial<ClinicalSummary> = {}): ClinicalSummary {
  return {
    id: 's1',
    encounterId: 'e1',
    status: 'draft',
    label: 'AI draft – review before use',
    revision: 0,
    encounterVersion: 1,
    isOutdated: false,
    aiDraft: {
      oneLineSummary: 'Adult with three days of fever, likely viral.',
      presentingComplaint: 'Fever for 3 days',
      keyFindings: ['Temperature 38.4 °C', 'Pulse 96/min'],
      vitalsHighlights: ['Febrile'],
      assessment: 'Viral fever',
      plan: ['Paracetamol 650 mg three times a day for 3 days', 'Fluids and rest'],
      medications: ['Paracetamol 650 mg'],
      investigations: [],
      followUp: 'Review if the fever lasts beyond 3 days',
      flagsForClinician: ['No allergy history was recorded for paracetamol'],
    },
    finalText: 'Adult with three days of fever, likely viral. Paracetamol and rest.',
    editedByDoctor: false,
    shareWithPatient: false,
    serverFlags: ['unverified_diagnosis_removed'],
    promptVersion: 'clinical_summary.v1',
    model: 'mock-model',
    isFallbackModel: false,
    errorCode: null,
    generatedBy: { id: 'dr1', name: 'Dr Anil Mehta' },
    generatedAt: '2026-10-01T05:10:00.000Z',
    reviewedBy: null,
    reviewedAt: null,
    rejectionReason: null,
    supersededAt: null,
    ...over,
  };
}

export const approvedSummary = (over: Partial<ClinicalSummary> = {}) =>
  summary({
    status: 'approved',
    label: 'AI-assisted · reviewed',
    revision: 1,
    reviewedBy: { id: 'dr1', name: 'Dr Anil Mehta' },
    reviewedAt: '2026-10-01T06:00:00.000Z',
    ...over,
  });

export function summaryState(over: Partial<SummaryState> = {}): SummaryState {
  return {
    draft: null,
    approved: null,
    lastAttempt: null,
    isOutdated: false,
    noteSigned: false,
    aiEnabled: true,
    ...over,
  };
}

const DISCLAIMER = {
  en: 'This explanation was written by AI from your doctor’s instructions. It does not replace your doctor’s advice. If anything here differs from what your doctor told you, follow your doctor.',
  hi: 'यह जानकारी AI ने आपके डॉक्टर के निर्देशों से लिखी है। यह डॉक्टर की सलाह की जगह नहीं लेती। अगर कुछ अलग लगे, तो अपने डॉक्टर की बात मानें।',
};

export function explanation(over: Partial<Explanation> = {}): Explanation {
  const language = over.language ?? 'en';
  const hi = language === 'hi';
  return {
    id: `x-${language}`,
    sourceType: 'prescription',
    sourceId: 'rx1',
    sourceVersion: 1,
    language,
    label: 'Explained in simple words by AI, from your doctor’s instructions',
    content: {
      overview: hi
        ? 'आपके डॉक्टर ने बुखार के लिए एक दवा दी है।'
        : 'Your doctor has given you one medicine for the fever.',
      medicines: [
        {
          name: 'Paracetamol 650 mg',
          whatToDo: hi ? '1 गोली लें' : 'Take 1 tablet',
          whenToTake: hi ? 'दिन में 3 बार, खाने के बाद' : 'Three times a day, after food',
          howLong: hi ? '३ दिन' : '3 days',
          tips: hi ? ['पानी के साथ लें'] : ['Take it with water'],
        },
      ],
      followUp: '',
      questionsToAskDoctor: hi ? ['बुखार कब तक रहेगा?'] : ['How long should the fever last?'],
      whenToContactClinic: hi
        ? ['साँस लेने में तकलीफ़ हो']
        : ['You have trouble breathing', 'The fever lasts more than 3 days'],
    },
    disclaimer: DISCLAIMER[language],
    isFallback: false,
    fromCache: true,
    preview: false,
    generatedAt: '2026-10-01T07:00:00.000Z',
    feedback: null,
    ...over,
  };
}

export function interaction(over: Partial<AiInteraction> = {}): AiInteraction {
  return {
    id: 'i1',
    callId: 'call-1',
    attempt: 1,
    feature: 'patient_explanation',
    status: 'blocked',
    provider: 'openai_compatible',
    model: 'openai/gpt-oss-120b',
    isFallbackModel: false,
    promptVersion: 'patient_explanation.v1',
    errorReason: null,
    guardrailFlags: ['forbidden_phrase'],
    usage: { inputTokens: 900, outputTokens: 300 },
    latencyMs: 2400,
    requestedByRole: 'patient',
    sourceType: 'prescription',
    createdAt: '2026-10-12T05:00:00.000Z',
    ...over,
  };
}

export function interactionSummary(over: Partial<AiInteractionSummary> = {}): AiInteractionSummary {
  return {
    range: { from: '2026-09-13', to: '2026-10-12' },
    attempts: 48,
    calls: 40,
    failureRate: 0.125,
    fallbackModelRate: 0.05,
    templateFallbackRate: 0.2,
    explanations: 25,
    guardrailBlocks: 6,
    guardrailFlags: [{ flag: 'forbidden_phrase', count: 4 }],
    tokens: { input: 42000, output: 9000 },
    latency: { averageMs: 2100, p95Ms: 5400 },
    feedback: { rated: 10, helpful: 8, helpfulPercent: 80 },
    perModel: [
      { model: 'openai/gpt-oss-120b', attempts: 44, failed: 5, blocked: 6 },
      { model: 'llama-3.3-70b-versatile', attempts: 4, failed: 1, blocked: 0 },
    ],
    perDay: [
      { date: '2026-10-11', attempts: 20, failed: 2, blocked: 3, tokens: 21000 },
      { date: '2026-10-12', attempts: 28, failed: 4, blocked: 3, tokens: 30000 },
    ],
    ...over,
  };
}

export function aiConfig(over: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: 'openai_compatible',
    baseUrlHost: 'api.groq.com',
    model: 'openai/gpt-oss-120b',
    fallbackModels: ['llama-3.3-70b-versatile'],
    timeoutMs: 30000,
    temperature: 0.2,
    maxTokens: 4000,
    today: { calls: 41, limit: 300 },
    enabled: {
      ai: true,
      clinicalSummary: true,
      patientExplanation: true,
      explanationLanguages: ['en', 'hi'],
    },
    ...over,
  };
}
