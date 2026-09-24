import { faker } from '@faker-js/faker';
import { ROLES, type LabOrderStatus } from '../config/constants.js';
import { Encounter } from '../modules/encounters/model.js';
import { LabOrder } from '../modules/labOrders/model.js';
import { selectRange, type ParameterLike, type RangeLike } from '../modules/labOrders/ranges.js';
import type { ResultInput } from '../modules/labOrders/results.js';
import { reviseItem, verifyRevision } from '../modules/labOrders/revision.service.js';
import type { LabOrderLike } from '../modules/labOrders/serializer.js';
import {
  cancelLabOrderItem,
  insertPlacedOrderForSeed,
  loadLabOrder,
} from '../modules/labOrders/service.js';
import {
  acknowledgeResults,
  collectSample,
  rejectSample,
  releaseOrder,
  saveItemResults,
  startProcessing,
  verifyOrder,
} from '../modules/labOrders/workflow.service.js';
import { LabTest } from '../modules/labTests/model.js';
import { Patient } from '../modules/patients/model.js';
import { getSettings } from '../modules/settings/service.js';
import { User } from '../modules/users/model.js';
import type { AuthUser } from '../types/express.js';
import { ageOn, clinicToday } from '../utils/dates.js';
import { SEED_REQUEST, seedActor } from './context.js';
import {
  ABNORMAL_SHARE,
  ACKNOWLEDGED_SHARE,
  CRITICAL_AT_STATUS,
  ITEM_CANCEL_AT_STATUS,
  ITEM_CANCEL_REASONS,
  LAB_ORDER_SPREAD,
  REJECTION_REASONS,
  TESTS_BY_DIAGNOSIS,
  TEXT_VALUES,
} from './data/labOrders.js';
import { doctorActor, seedFor } from './encounters.js';

/**
 * Lab orders (spec §15.3), after the notes: ~80 orders on signed notes whose primary diagnosis
 * suits a test (CBC/CRP for fevers, HbA1c/FBS for diabetes, lipids/KFT for hypertension, …),
 * then taken through the REAL lab services by the two demo lab technicians – lab1 collects and
 * enters results, lab2 verifies and releases (dual verification) – so every released order has
 * its PDF report. Spread: see LAB_ORDER_SPREAD; ~15 % of numeric results out of range, three
 * critical values, one released result revised, a few cancelled tests, ~60 % of released orders
 * acknowledged (the rest fill "results to review"). patient1 gets a released report.
 *
 * Orders are placed at the note's signing time; the lab steps happen when the seed runs (the
 * services stamp "now"). Deterministic (choices from the encounter number) and run once: when
 * any lab order exists the seeder only reports the counts. `--reset` clears them.
 */

type Mode = 'normal' | 'abnormal' | 'critical';

const round = (value: number, range: RangeLike | null) => {
  const mag = range?.high ?? range?.low ?? value;
  const digits = mag <= 1.1 && (range?.low ?? 0) >= 1 ? 3 : mag < 2 ? 2 : mag < 20 ? 1 : 0;
  return Number(value.toFixed(digits));
};

/** A plausible value for one parameter. */
function valueFor(p: ParameterLike, range: RangeLike | null, mode: Mode): unknown {
  if (p.valueType === 'option') {
    const abnormal = p.abnormalOptions ?? [];
    const normal = (p.options ?? []).filter((o) => !abnormal.includes(o));
    if (mode !== 'normal' && abnormal.length > 0) return abnormal[0];
    if (p.key === 'abo') return faker.helpers.arrayElement(p.options ?? ['O']);
    return normal[0] ?? p.options?.[0];
  }
  if (p.valueType === 'text') return TEXT_VALUES[p.key] ?? 'Normal';
  const low = range?.low ?? undefined;
  const high = range?.high ?? undefined;
  const between = (a: number, b: number) => faker.number.float({ min: a, max: b });
  let v: number;
  if (mode === 'critical' && range?.criticalLow !== undefined && range?.criticalLow !== null) {
    v = range.criticalLow * 0.8;
  } else if (
    mode === 'critical' &&
    range?.criticalHigh !== undefined &&
    range?.criticalHigh !== null
  ) {
    v = range.criticalHigh * 1.1;
  } else if (mode !== 'normal' && high !== undefined) {
    v = between(high * 1.05, high * 1.3);
  } else if (mode !== 'normal' && low !== undefined) {
    v = between(low * 0.75, low * 0.95);
  } else if (low !== undefined && high !== undefined) {
    v = between(low + (high - low) * 0.1, high - (high - low) * 0.1);
  } else if (high !== undefined) {
    v = between(high * 0.5, high * 0.9);
  } else if (low !== undefined) {
    v = between(low * 1.1, low * 1.6);
  } else {
    v = between(1, 10);
  }
  return round(v, range);
}

const hasCriticalLimit = (p: ParameterLike, range: RangeLike | null) =>
  p.valueType === 'number' &&
  range !== null &&
  (typeof range.criticalLow === 'number' || typeof range.criticalHigh === 'number');

/** The status each position ends in (open ones first = the most recent notes). */
function plannedStatuses(n: number): LabOrderStatus[] {
  const plan = LAB_ORDER_SPREAD.flatMap(([status, count]) =>
    Array<LabOrderStatus>(count).fill(status),
  );
  return plan.slice(0, n);
}

export async function seedLabOrders(): Promise<Record<string, number>> {
  const existing = await LabOrder.estimatedDocumentCount();
  if (existing > 0) return { created: 0, unchanged: existing, ...(await countsByStatus()) };

  const { timezone } = await getSettings();
  const today = clinicToday(timezone);
  const lab1 = await seedActor('lab1@medassist.dev', ROLES.LABTECH);
  const lab2 = await seedActor('lab2@medassist.dev', ROLES.LABTECH);
  const tests = new Map((await LabTest.find({ isActive: true }).lean()).map((t) => [t.code, t]));

  // Signed notes whose primary diagnosis suits a test, most recent first.
  const notes = await Encounter.find({ status: { $in: ['signed', 'amended'] } })
    .select('encounterNumber patient doctor appointment diagnoses signedAt')
    .sort({ signedAt: -1, encounterNumber: -1 })
    .lean();
  const plan = LAB_ORDER_SPREAD.reduce((sum, [, n]) => sum + n, 0);
  let candidates = notes
    .map((e) => {
      const primary = e.diagnoses.find((d) => d.isPrimary) ?? e.diagnoses[0];
      const match = TESTS_BY_DIAGNOSIS.find((m) => primary?.icd10Code?.startsWith(m.prefix));
      return match ? { e, match } : null;
    })
    .filter((c): c is NonNullable<typeof c> => c !== null)
    .slice(0, plan);
  // patient1 (a portal login) gets a released report.
  const patient1 = (
    await User.findOne({ email: 'patient1@medassist.dev' }).select('patient').lean()
  )?.patient;
  const openCount = plan - (LAB_ORDER_SPREAD.find(([s]) => s === 'released')?.[1] ?? 0);
  const p1 = candidates.findIndex((c) => patient1 && c.e.patient.equals(patient1));
  if (p1 >= 0 && p1 < openCount && candidates.length > openCount) {
    const [moved] = candidates.splice(p1, 1);
    candidates = [...candidates.slice(0, openCount), moved!, ...candidates.slice(openCount)];
  }
  const statuses = plannedStatuses(candidates.length);

  const patients = new Map(
    (
      await Patient.find({ _id: { $in: candidates.map((c) => c.e.patient) } })
        .select('dateOfBirth gender')
        .lean()
    ).map((p) => [p._id.toString(), p]),
  );
  const doctors = new Map<string, AuthUser>();
  const doctorFor = async (id: LabOrderLike['orderedBy']['_id']) => {
    const key = id.toString();
    if (!doctors.has(key)) doctors.set(key, await doctorActor(id));
    return doctors.get(key)!;
  };
  const criticalsLeft = [...CRITICAL_AT_STATUS];
  const cancelsLeft = [...ITEM_CANCEL_AT_STATUS];
  const released: { order: LabOrderLike; doctor: AuthUser }[] = [];
  let urgentGiven = false;
  const result = {
    created: 0,
    unchanged: 0,
    criticals: 0,
    cancelledTests: 0,
    revised: 0,
    acknowledged: 0,
  };

  for (const [index, { e, match }] of candidates.entries()) {
    const target = statuses[index]!;
    faker.seed(seedFor(`lab:${e.encounterNumber}`));
    const doctor = await doctorFor(e.doctor);
    const testIds = match.tests
      .map((code) => tests.get(code)?._id.toString())
      .filter(Boolean) as string[];
    if (testIds.length === 0) continue;
    const urgent: boolean = target === 'ordered' && !urgentGiven;
    urgentGiven ||= urgent;
    const order = await insertPlacedOrderForSeed(
      {
        doctor,
        encounter: e,
        testIds,
        priority: urgent ? 'urgent' : 'routine',
        clinicalNotes: match.notes,
        orderedAt: e.signedAt ?? new Date(),
      },
      SEED_REQUEST,
    );
    result.created += 1;
    const id = order._id.toString();

    // One of several tests cancelled before results.
    const cancelAt = cancelsLeft.indexOf(target);
    if (cancelAt >= 0 && order.items.length > 1) {
      cancelsLeft.splice(cancelAt, 1);
      await cancelLabOrderItem(
        lab1,
        id,
        order.items.at(-1)!._id.toString(),
        { reason: ITEM_CANCEL_REASONS[result.cancelledTests % ITEM_CANCEL_REASONS.length]! },
        SEED_REQUEST,
      );
      result.cancelledTests += 1;
    }
    if (target === 'ordered') continue;
    await collectSample(lab1, id, SEED_REQUEST);
    if (target === 'sample_collected') continue;
    if (target === 'sample_rejected') {
      await rejectSample(lab1, id, { reason: REJECTION_REASONS[index % 2]! }, SEED_REQUEST);
      continue;
    }
    await startProcessing(lab1, id, SEED_REQUEST);
    if (target === 'processing') continue;

    // Results for every open test (lab1), with one critical value where planned.
    const patient = patients.get(e.patient.toString());
    const subject = {
      gender: patient?.gender ?? null,
      ageYears: patient ? ageOn(patient.dateOfBirth, today) : null,
    };
    const criticalAt = criticalsLeft.indexOf(target);
    let critical = criticalAt >= 0;
    const open = (await LabOrder.findById(id).select('items').lean())!.items.filter(
      (i) => i.status !== 'cancelled',
    );
    const withCritical = open.some((i) => {
      const t = [...tests.values()].find((x) => x._id.equals(i.test));
      return (t?.parameters ?? []).some((p) => hasCriticalLimit(p, selectRange(p, subject)));
    });
    if (!withCritical) critical = false;
    for (const item of open) {
      const t = [...tests.values()].find((x) => x._id.equals(item.test));
      const results: ResultInput[] = (t?.parameters ?? []).map((p) => {
        const range = selectRange(p, subject);
        let mode: Mode = faker.number.float() < ABNORMAL_SHARE ? 'abnormal' : 'normal';
        if (critical && hasCriticalLimit(p, range)) {
          mode = 'critical';
          critical = false;
          criticalsLeft.splice(criticalAt, 1);
          result.criticals += 1;
        }
        return { parameterKey: p.key, value: valueFor(p, range, mode) };
      });
      await saveItemResults(lab1, id, item._id.toString(), { results }, SEED_REQUEST);
    }
    if (target === 'result_entered') continue;
    await verifyOrder(lab2, id, SEED_REQUEST);
    if (target === 'verified') continue;
    await releaseOrder(lab2, id, SEED_REQUEST);
    released.push({ order: await loadLabOrder(id, { detail: true }), doctor });
  }

  // One released result revised once (lab1 revises, lab2 verifies).
  const toRevise = released.find((r) => r.order.items.some((i) => i.status === 'verified'));
  if (toRevise) {
    const item = toRevise.order.items.find((i) => i.status === 'verified')!;
    const results = item.results.map((r) => ({
      parameterKey: r.parameterKey,
      value: typeof r.value === 'number' ? Number((r.value * 1.04).toFixed(2)) : r.value,
    }));
    const id = toRevise.order._id.toString();
    await reviseItem(
      lab1,
      id,
      item._id.toString(),
      { results, reason: 'Transcription error corrected after re-checking the analyser print-out' },
      SEED_REQUEST,
    );
    await verifyRevision(lab2, id, item._id.toString(), SEED_REQUEST);
    result.revised += 1;
  }

  // Most released results already reviewed by their doctors; the rest wait in "results to review".
  for (const { order, doctor } of released) {
    faker.seed(seedFor(`ack:${order.orderNumber}`));
    if (faker.number.float() >= ACKNOWLEDGED_SHARE) continue;
    await acknowledgeResults(doctor, order._id.toString(), SEED_REQUEST);
    result.acknowledged += 1;
  }
  return { ...result, ...(await countsByStatus()) };
}

/** Orders per status, for the seed summary. */
async function countsByStatus(): Promise<Record<string, number>> {
  const rows = await LabOrder.aggregate<{ _id: string; n: number }>([
    { $group: { _id: '$status', n: { $sum: 1 } } },
  ]);
  return Object.fromEntries(
    rows.sort((a, b) => a._id.localeCompare(b._id)).map((r) => [r._id, r.n]),
  );
}
