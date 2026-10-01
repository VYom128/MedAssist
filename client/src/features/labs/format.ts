import type { LabFlag, LabOrderStatus } from '../../constants/catalog';
import { clinicDate } from '../../utils/dates';
import type { FlagCounts, LabItem, LabOrder, LabOrderListParams } from './api';

/**
 * The lab worklist tabs (spec §13.4 #6): each is a list filter. "Released today" uses the clinic
 * date of release.
 */
export const WORKLIST_TABS = [
  { id: 'collect', label: 'To collect', status: 'ordered' },
  { id: 'collected', label: 'Collected', status: 'sample_collected' },
  { id: 'processing', label: 'Processing', status: 'processing' },
  { id: 'verify', label: 'Awaiting verification', status: 'result_entered' },
  { id: 'verified', label: 'Verified', status: 'verified' },
  { id: 'released', label: 'Released today', status: 'released' },
  { id: 'rejected', label: 'Rejected', status: 'sample_rejected' },
] as const satisfies readonly { id: string; label: string; status: LabOrderStatus }[];
export type WorklistTab = (typeof WORKLIST_TABS)[number]['id'];

/** List filters for a worklist tab. */
export function tabParams(tab: WorklistTab, q?: string): LabOrderListParams {
  const t = WORKLIST_TABS.find((x) => x.id === tab) ?? WORKLIST_TABS[0];
  return {
    status: t.status,
    ...(t.id === 'released' ? { releasedOn: clinicDate() } : {}),
    ...(q ? { q } : {}),
  };
}

export const openItems = (o: Pick<LabOrder, 'items'>) =>
  o.items.filter((i) => i.status !== 'cancelled');

/** "3 of 4 tests entered". */
export function entryProgress(o: Pick<LabOrder, 'items'>) {
  const open = openItems(o);
  const done = open.filter((i) => i.status === 'result_entered' || i.status === 'verified');
  return { done: done.length, total: open.length };
}

/** A flag worth drawing attention to (anything but normal / not applicable). */
export const isAbnormalFlag = (flag: LabFlag) => flag !== 'normal' && flag !== 'na';
export const isCriticalFlag = (flag: LabFlag) =>
  flag === 'critical_low' || flag === 'critical_high';

export const formatResultValue = (value: number | string | null) =>
  value === null || value === '' ? '—' : String(value);

/** Statuses in which a pending test may still be cancelled (server LAB_ITEM_CANCELLABLE_IN). */
const ITEM_CANCELLABLE_IN: readonly LabOrderStatus[] = [
  'ordered',
  'sample_collected',
  'sample_rejected',
  'processing',
];
export const canCancelItem = (o: Pick<LabOrder, 'status'>, item: Pick<LabItem, 'status'>) =>
  item.status === 'pending' && ITEM_CANCELLABLE_IN.includes(o.status);

/** With dual verification on, the verifier must not have entered any of the results. */
export function selfVerificationBlocked(o: LabOrder, userId: string | undefined) {
  if (!userId || o.requireDualVerification === false) return false;
  return openItems(o).some((i) => i.enteredBy?.id === userId);
}

/** The patient's sex and age at collection, for reference ranges. */
export const subjectOf = (o: Pick<LabOrder, 'patient' | 'sample'>) => ({
  gender: o.patient.gender,
  ageYears: o.sample?.patientAgeYears ?? o.patient.age,
});

/** Statuses a doctor can still order more tests after signing: within 72 h of the visit. */
export function withinDocumentationWindow(
  completedAt: string | null | undefined,
  now = Date.now(),
) {
  if (!completedAt) return false;
  return now - new Date(completedAt).getTime() <= 72 * 3_600_000;
}

/** "2 high, 1 low, 1 critical" – or "All within range" (null when nothing is visible yet). */
export function flagSummaryText(flags: FlagCounts | undefined): string | null {
  if (!flags) return null;
  const parts = [
    flags.critical ? `${flags.critical} critical` : null,
    flags.high ? `${flags.high} high` : null,
    flags.low ? `${flags.low} low` : null,
    flags.abnormal ? `${flags.abnormal} abnormal` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : 'All within range';
}

/** What a patient reads for a critical value (calm wording, no alarm). */
export const PATIENT_CRITICAL_TEXT = 'Outside reference range – your doctor has been informed';
