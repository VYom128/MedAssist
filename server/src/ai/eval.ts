import { connectDB, disconnectDB } from '../config/db.js';
import { config } from '../config/env.js';
import { EXPLANATION_LANGUAGES } from '../config/constants.js';
import { ISSUED_STATUSES } from '../policies/prescriptionAccess.js';
import { Encounter } from '../modules/encounters/model.js';
import { loadEncounter } from '../modules/encounters/service.js';
import { buildPrescriptionInput } from '../modules/explanations/input.js';
import { Prescription } from '../modules/prescriptions/model.js';
import { loadPrescription } from '../modules/prescriptions/service.js';
import { buildSummaryInput } from '../modules/summaries/input.js';
import { AiCallError, generateJson } from './ai.service.js';
import { runExplanation } from './explanation.js';
import {
  buildUserMessage,
  PROMPT_VERSION,
  SCHEMA_NAME,
  summaryOutputSchema,
  SYSTEM_PROMPT,
} from './prompts/clinicalSummary.v1.js';
import { usingMock } from './providers/index.js';
import { checkSummary } from './summary/checks.js';

/**
 * `npm run ai:eval -- --confirm [--limit 5]` (spec §9.4): runs the clinical summary on `limit`
 * seeded signed notes and the patient explanation (en + hi) on `limit` seeded issued
 * prescriptions through the REAL service path (de-identification, model chain, retries, server
 * checks, guardrails) and prints one row per item – never patient data, inputs or outputs.
 * Writes only the normal ai_interactions rows and ai.call audit entries (no summaries or
 * explanations). Refuses with the mock provider or without --confirm; stops at the daily limit.
 */

export const DEFAULT_LIMIT = 5;

export interface EvalOptions {
  limit: number;
}

/** Why the eval must not run (or null), and its options. */
export function parseEvalArgs(
  argv: readonly string[],
  mock: boolean,
): { refusal: string | null; options: EvalOptions } {
  const i = argv.indexOf('--limit');
  const raw = i >= 0 ? Number(argv[i + 1]) : DEFAULT_LIMIT;
  const limit = Number.isInteger(raw) && raw > 0 && raw <= 50 ? raw : DEFAULT_LIMIT;
  const options = { limit };
  if (mock) {
    return {
      refusal:
        'Refusing to run: the eval needs a real provider – set AI_PROVIDER=openai_compatible ' +
        '(with AI_BASE_URL, AI_API_KEY and AI_MODEL) in server/.env.',
      options,
    };
  }
  if (!argv.includes('--confirm')) {
    return {
      refusal:
        `Refusing to run: this makes about ${limit * 3} real AI calls (more with retries and ` +
        'fallbacks) and uses the daily AI limit. Re-run with --confirm.',
      options,
    };
  }
  return { refusal: null, options };
}

export interface Row {
  feature: string;
  n: number;
  language: string;
  model: string;
  attempts: number;
  status: string;
  flags: string;
  isFallback: string;
  latencyMs: number;
  tokens: string;
}

export function table(rows: Row[]): string {
  const header = [
    'feature',
    '#',
    'lang',
    'model used',
    'attempts',
    'status',
    'flags',
    'template',
    'latency ms',
    'tokens in/out',
  ];
  const cells = [
    header,
    ...rows.map((r) => [
      r.feature,
      String(r.n),
      r.language,
      r.model,
      String(r.attempts),
      r.status,
      r.flags || '-',
      r.isFallback,
      String(r.latencyMs),
      r.tokens,
    ]),
  ];
  const widths = header.map((_, i) => Math.max(...cells.map((c) => c[i]!.length)));
  return cells
    .map((c) =>
      c
        .map((v, i) => v.padEnd(widths[i]!))
        .join('  ')
        .trimEnd(),
    )
    .join('\n');
}

const isDailyLimit = (err: unknown) =>
  err instanceof AiCallError &&
  (err.details as { reason?: string } | undefined)?.reason === 'daily_limit';

class DailyLimitReached extends Error {}

async function evalSummaries(limit: number, rows: Row[]) {
  const notes = await Encounter.find({ status: { $in: ['signed', 'amended'] } })
    .select('_id')
    .sort({ signedAt: -1, _id: 1 })
    .limit(limit)
    .lean();
  for (const [i, note] of notes.entries()) {
    const e = await loadEncounter(note._id);
    const { input } = await buildSummaryInput(e);
    try {
      const r = await generateJson({
        feature: 'clinical_summary',
        promptVersion: PROMPT_VERSION,
        schemaName: SCHEMA_NAME,
        system: SYSTEM_PROMPT,
        input: input as unknown as Record<string, unknown>,
        userMessage: buildUserMessage(input),
        schema: summaryOutputSchema,
        user: null,
        source: { type: 'encounter', id: e._id, version: e.version },
      });
      const { flags } = checkSummary(r.data, input);
      rows.push({
        feature: 'summary',
        n: i + 1,
        language: 'en',
        model: r.model,
        attempts: r.attempts,
        status: flags.length ? 'flagged' : 'ok',
        flags: flags.join(','),
        isFallback: '-',
        latencyMs: r.latencyMs,
        tokens: `${r.usage.inputTokens}/${r.usage.outputTokens}`,
      });
    } catch (err) {
      if (!(err instanceof AiCallError)) throw err;
      rows.push({
        feature: 'summary',
        n: i + 1,
        language: 'en',
        model: '-',
        attempts: err.attempts,
        status: err.code,
        flags: err.reasons.join(','),
        isFallback: '-',
        latencyMs: 0,
        tokens: '-',
      });
      if (isDailyLimit(err)) throw new DailyLimitReached();
    }
  }
}

async function evalExplanations(limit: number, rows: Row[]) {
  const prescriptions = await Prescription.find({ status: { $in: ISSUED_STATUSES } })
    .select('_id')
    .sort({ issuedAt: -1, _id: 1 })
    .limit(limit)
    .lean();
  for (const [i, { _id }] of prescriptions.entries()) {
    const rx = await loadPrescription(_id);
    for (const language of EXPLANATION_LANGUAGES) {
      const run = await runExplanation(await buildPrescriptionInput(rx, language), {
        user: null,
        source: { type: 'prescription', id: rx._id },
      });
      rows.push({
        feature: 'explanation',
        n: i + 1,
        language,
        model: run.model ?? '-',
        attempts: run.attempts,
        status: run.outcome,
        flags: run.flags.join(','),
        isFallback: run.isFallback ? 'yes' : 'no',
        latencyMs: run.latencyMs,
        tokens: `${run.usage.inputTokens}/${run.usage.outputTokens}`,
      });
      if (run.flags.includes('daily_limit')) throw new DailyLimitReached();
    }
  }
}

export async function runEval(
  argv: readonly string[],
  out: (line: string) => void,
): Promise<number> {
  const { refusal, options } = parseEvalArgs(argv, usingMock());
  if (refusal) {
    out(refusal);
    return 1;
  }
  await connectDB();
  const rows: Row[] = [];
  let stopped = false;
  try {
    out(
      `AI eval: ${config.ai.model} (fallbacks: ${config.ai.fallbackModels.join(', ') || 'none'}), ` +
        `${options.limit} notes and ${options.limit} prescriptions (en + hi). Prompts: ` +
        'clinicalSummary.v1, patientExplanation.v1.',
    );
    try {
      await evalSummaries(options.limit, rows);
      await evalExplanations(options.limit, rows);
    } catch (err) {
      if (!(err instanceof DailyLimitReached)) throw err;
      stopped = true;
    }
    out(table(rows));
    const needsReview = rows.filter((r) => !['ok', 'success'].includes(r.status)).length;
    out(
      `\n${rows.length} items, ${needsReview} flagged, blocked or failed – review them by hand.` +
        (stopped ? '\nStopped: the daily AI limit (AI_DAILY_CALL_LIMIT) was reached.' : ''),
    );
    return 0;
  } finally {
    await disconnectDB();
  }
}
