import {
  DIAGNOSIS_TYPE_LABELS,
  ICD10_PATTERN,
  NOTE_FIELD_LABELS,
  VITALS,
  VITAL_KEYS,
  type DiagnosisType,
  type NoteField,
} from '../../constants/catalog';
import { clinicDate, formatCalendarDate } from '../../utils/dates';
import type { Prescription } from '../prescriptions/api';
import type { Diagnosis, Encounter, FollowUp, NoteChanges } from './api';

/** The consult workspace tabs (spec §4.7; lab orders and the AI summary come in later phases). */
export const CONSULT_TABS = [
  { id: 'vitals', label: 'Vitals' },
  { id: 'notes', label: 'Notes' },
  { id: 'diagnosis', label: 'Diagnosis & plan' },
  { id: 'prescription', label: 'Prescription' },
  { id: 'followup', label: 'Follow-up' },
] as const;
export type ConsultTab = (typeof CONSULT_TABS)[number]['id'];

const FIELD_TAB: Record<NoteField, ConsultTab> = {
  vitals: 'vitals',
  chiefComplaint: 'notes',
  historyOfPresentIllness: 'notes',
  pastHistory: 'notes',
  examination: 'notes',
  diagnoses: 'diagnosis',
  assessment: 'diagnosis',
  plan: 'diagnosis',
  adviceToPatient: 'diagnosis',
  followUp: 'followup',
};

/** Element id of a note field's control (links from problems focus it). */
export const fieldId = (path: string) => `enc-${path.replace(/\./g, '-')}`;

/**
 * Where a server or client problem path points: the tab, the element to focus and a label.
 * 'chiefComplaint', 'diagnoses', 'vitals.pulse', 'prescription.items.0.dose', 'items.0'.
 */
export function fieldTarget(path: string): { tab: ConsultTab; elementId: string; label: string } {
  const parts = path.split('.');
  if (parts[0] === 'prescription' || parts[0] === 'items') {
    const rest = parts[0] === 'prescription' ? parts.slice(1) : parts;
    const index = Number(rest[1]);
    const what = rest[2] ? ` – ${rest[2].replace(/([A-Z])/g, ' $1').toLowerCase()}` : '';
    return {
      tab: 'prescription',
      elementId: Number.isInteger(index) ? `rx-item-${index}` : 'rx-items',
      label: Number.isInteger(index) ? `Prescription item ${index + 1}${what}` : 'Prescription',
    };
  }
  const field = parts[0] as NoteField;
  const tab = FIELD_TAB[field] ?? 'notes';
  if (field === 'diagnoses') {
    return {
      tab,
      elementId: parts[1] ? fieldId(`diagnoses.${parts[1]}.description`) : 'enc-diagnoses-add',
      label: NOTE_FIELD_LABELS.diagnoses,
    };
  }
  if (field === 'vitals' && parts[1] && parts[1] in VITALS) {
    return { tab, elementId: fieldId(path), label: VITALS[parts[1] as keyof typeof VITALS].label };
  }
  return { tab, elementId: fieldId(path), label: NOTE_FIELD_LABELS[field] ?? path };
}

// ---- Client checks (the server re-checks everything) -----------------------------------------

/** Problems per diagnosis row (index → message). */
export function diagnosisProblems(diagnoses: readonly Diagnosis[]): Record<number, string> {
  const out: Record<number, string> = {};
  diagnoses.forEach((d, i) => {
    if (!d.description.trim()) out[i] = 'Describe the diagnosis';
    else if (d.icd10Code && !ICD10_PATTERN.test(d.icd10Code.trim().toUpperCase())) {
      out[i] = 'Use an ICD-10 code such as J06.9';
    }
  });
  return out;
}

export function followUpProblem(f: FollowUp): string | null {
  if (!f.required) return null;
  if (f.afterDays !== null && f.date !== null) return 'Give either days or a date, not both';
  if (f.date !== null && f.date <= clinicDate()) return 'Choose a future date';
  return null;
}

/**
 * Splits pending edits into what can be autosaved now and what must wait: diagnoses with an empty
 * row or a malformed code, and an inconsistent follow-up, are held until fixed (sending them would
 * be refused and a half-typed row would disappear on the round trip).
 */
export function splitSendable(edits: NoteChanges): { send: NoteChanges; hold: NoteChanges } {
  const send: NoteChanges = { ...edits };
  const hold: NoteChanges = {};
  if (edits.diagnoses && Object.keys(diagnosisProblems(edits.diagnoses)).length > 0) {
    hold.diagnoses = edits.diagnoses;
    delete send.diagnoses;
  }
  if (edits.followUp && followUpProblem(edits.followUp)) {
    hold.followUp = edits.followUp;
    delete send.followUp;
  }
  return { send, hold };
}

/** The API body for changes: trimmed diagnosis fields. */
export function toBody(changes: NoteChanges): NoteChanges {
  if (!changes.diagnoses) return changes;
  return {
    ...changes,
    diagnoses: changes.diagnoses.map((d) => ({
      ...d,
      description: d.description.trim(),
      icd10Code: d.icd10Code?.trim() ? d.icd10Code.trim().toUpperCase() : null,
    })),
  };
}

export const hasVitals = (e: Pick<Encounter, 'vitals'>) =>
  VITAL_KEYS.some((k) => e.vitals[k] !== null && e.vitals[k] !== undefined);

export interface Problem {
  field: string;
  message: string;
}

/**
 * What signing needs (spec §8.5, §8.6), checked before asking the server: a chief complaint,
 * a diagnosis, complete prescription items and acknowledged allergy warnings. Empty vitals are a
 * warning only.
 */
export function signCheck(note: Encounter, prescription: Prescription | null) {
  const problems: Problem[] = [];
  if (!note.chiefComplaint?.trim()) {
    problems.push({ field: 'chiefComplaint', message: 'Chief complaint is required' });
  }
  if (note.diagnoses.length === 0) {
    problems.push({ field: 'diagnoses', message: 'Add at least one diagnosis' });
  }
  Object.entries(diagnosisProblems(note.diagnoses)).forEach(([i, message]) =>
    problems.push({ field: `diagnoses.${i}`, message }),
  );
  const followUp = followUpProblem(note.followUp);
  if (followUp) problems.push({ field: 'followUp.date', message: followUp });

  if (prescription?.status === 'draft') {
    prescription.items.forEach((item, i) => {
      const at = (f: string) => `prescription.items.${i}.${f}`;
      if (!item.dose) problems.push({ field: at('dose'), message: 'Dose is required' });
      if (!item.frequency)
        problems.push({ field: at('frequency'), message: 'Frequency is required' });
      else if (item.frequency === 'other' && !item.frequencyText) {
        problems.push({ field: at('frequencyText'), message: 'Describe the frequency' });
      }
      if (!item.durationDays) {
        problems.push({ field: at('durationDays'), message: 'Duration is required' });
      }
    });
    for (const w of prescription.allergyWarnings ?? []) {
      if (!w.acknowledged) {
        problems.push({
          field: `prescription.items.${w.itemIndex}`,
          message: `${w.drugName} matches the recorded allergy "${w.substance}" – acknowledge the warning`,
        });
      }
    }
  }
  const warnings = hasVitals(note) ? [] : ['No vitals were recorded for this visit.'];
  return { problems, warnings };
}

/** weight / (height m)², 1 decimal (mirrors the server). */
export function computeBmi(weightKg: number | null, heightCm: number | null): number | null {
  if (!weightKg || !heightCm) return null;
  const m = heightCm / 100;
  return Math.round((weightKg / (m * m)) * 10) / 10;
}

// ---- Display ---------------------------------------------------------------------------------

export function formatVitals(vitals: object | null | undefined) {
  if (!vitals) return '—';
  const v = vitals as Partial<Record<string, number | null>>;
  const parts: string[] = [];
  if (v.bpSystolic != null || v.bpDiastolic != null) {
    parts.push(`BP ${v.bpSystolic ?? '–'}/${v.bpDiastolic ?? '–'} mmHg`);
  }
  for (const key of [
    'pulse',
    'temperatureC',
    'respiratoryRate',
    'spo2',
    'weightKg',
    'heightCm',
  ] as const) {
    if (v[key] != null) parts.push(`${VITALS[key].label} ${v[key]} ${VITALS[key].unit}`);
  }
  if (v.bmi != null) parts.push(`BMI ${v.bmi}`);
  return parts.length ? parts.join(' · ') : '—';
}

export function formatDiagnosis(d: Pick<Diagnosis, 'description' | 'icd10Code' | 'type'>) {
  const type = DIAGNOSIS_TYPE_LABELS[d.type as DiagnosisType] ?? d.type;
  return `${d.description}${d.icd10Code ? ` (${d.icd10Code})` : ''} – ${type.toLowerCase()}`;
}

export function formatFollowUp(f: Partial<FollowUp> | null | undefined) {
  if (!f?.required) return 'No follow-up planned';
  const when = f.afterDays
    ? `after ${f.afterDays} day${f.afterDays === 1 ? '' : 's'}`
    : f.date
      ? `on ${formatCalendarDate(f.date)}`
      : 'date not set';
  return `Follow-up ${when}${f.instructions ? ` – ${f.instructions}` : ''}`;
}

/** A field's value in the amendment history (before/after snapshots). */
export function formatNoteValue(field: NoteField, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  switch (field) {
    case 'vitals':
      return formatVitals(value as object);
    case 'diagnoses':
      return (value as Diagnosis[]).map(formatDiagnosis).join('; ') || '—';
    case 'followUp':
      return formatFollowUp(value as FollowUp);
    default:
      return String(value);
  }
}
