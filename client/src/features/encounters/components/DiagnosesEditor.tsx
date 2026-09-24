import { Plus, Trash2 } from 'lucide-react';
import { useId } from 'react';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import {
  DIAGNOSIS_TYPES,
  DIAGNOSIS_TYPE_LABELS,
  MAX_DIAGNOSES,
  NOTE_TEXT_LIMITS,
  optionsOf,
  type DiagnosisType,
} from '../../../constants/catalog';
import type { Diagnosis, NoteChanges } from '../api';
import { diagnosisProblems, fieldId } from '../fields';

const blank = (primary: boolean): Diagnosis => ({
  description: '',
  icd10Code: null,
  type: 'provisional',
  isPrimary: primary,
});

/**
 * Repeatable diagnoses (spec §6.13): description, optional ICD-10 code, provisional/final and
 * one primary (radio). The whole list is one change; rows with problems are held back from
 * autosave until fixed (fields.ts splitSendable).
 */
export default function DiagnosesEditor({
  diagnoses,
  onChange,
  onBlur,
}: {
  diagnoses: Diagnosis[];
  onChange: (changes: NoteChanges) => void;
  onBlur?: () => void;
}) {
  const group = useId();
  const problems = diagnosisProblems(diagnoses);
  const set = (next: Diagnosis[]) => onChange({ diagnoses: next });
  const update = (i: number, patch: Partial<Diagnosis>) =>
    set(diagnoses.map((d, n) => (n === i ? { ...d, ...patch } : d)));

  return (
    <fieldset className="space-y-3">
      <legend className="text-card text-ink">Diagnoses (at least one needed to sign)</legend>
      {diagnoses.length === 0 && <p className="text-sm text-muted">No diagnosis added yet.</p>}
      <ol className="space-y-3">
        {diagnoses.map((d, i) => (
          <li
            key={i}
            aria-label={`Diagnosis ${i + 1}`}
            className="grid gap-3 rounded-control border border-line p-3 sm:grid-cols-[minmax(0,1fr)_8rem_9rem_auto]"
          >
            <Input
              id={fieldId(`diagnoses.${i}.description`)}
              label={`Diagnosis ${i + 1}`}
              value={d.description}
              maxLength={NOTE_TEXT_LIMITS.diagnosisDescription}
              error={problems[i] && !problems[i].startsWith('Use') ? problems[i] : undefined}
              onChange={(e) => update(i, { description: e.target.value })}
              onBlur={onBlur}
            />
            <Input
              label="ICD-10 (optional)"
              value={d.icd10Code ?? ''}
              placeholder="J06.9"
              maxLength={10}
              error={problems[i]?.startsWith('Use') ? 'e.g. J06.9' : undefined}
              onChange={(e) => update(i, { icd10Code: e.target.value || null })}
              onBlur={onBlur}
            />
            <Select
              label="Type"
              value={d.type}
              options={optionsOf(DIAGNOSIS_TYPES, DIAGNOSIS_TYPE_LABELS)}
              onChange={(e) => update(i, { type: e.target.value as DiagnosisType })}
              onBlur={onBlur}
            />
            <div className="flex items-end gap-2 pb-1">
              <label className="inline-flex min-h-11 items-center gap-2 text-sm text-ink">
                <input
                  type="radio"
                  name={`${group}-primary`}
                  checked={d.isPrimary}
                  onChange={() => set(diagnoses.map((x, n) => ({ ...x, isPrimary: n === i })))}
                  className="h-4 w-4 accent-primary-600"
                />
                Primary
              </label>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Remove diagnosis ${i + 1}`}
                onClick={() => {
                  const next = diagnoses.filter((_, n) => n !== i);
                  if (d.isPrimary && next[0]) next[0] = { ...next[0], isPrimary: true };
                  set(next);
                }}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </li>
        ))}
      </ol>
      <Button
        id="enc-diagnoses-add"
        variant="secondary"
        size="sm"
        disabled={diagnoses.length >= MAX_DIAGNOSES}
        onClick={() => set([...diagnoses, blank(diagnoses.length === 0)])}
      >
        <Plus className="h-4 w-4" aria-hidden="true" /> Add diagnosis
      </Button>
    </fieldset>
  );
}
