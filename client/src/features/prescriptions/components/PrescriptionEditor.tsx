import { ArrowDown, ArrowUp, Plus, Trash2, TriangleAlert } from 'lucide-react';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Textarea from '../../../components/ui/Textarea';
import {
  DRUG_FORMS,
  DRUG_FREQUENCIES,
  DRUG_FREQUENCY_LABELS,
  DRUG_ROUTE_LABELS,
  DRUG_ROUTES,
  DRUG_TIMING_LABELS,
  MAX_DURATION_DAYS,
  MAX_PRESCRIPTION_ITEMS,
  RX_TEXT_LIMITS,
  capitalise,
  optionsOf,
  type DrugFrequency,
  type DrugTiming,
} from '../../../constants/catalog';
import type { FormularyDrug, Prescription } from '../api';
import { blankRow, previewText, warningFor, type RxRow } from '../rows';
import type { PrescriptionDraft } from '../usePrescriptionDraft';
import DrugNameInput from './DrugNameInput';

const FORM_OPTIONS = DRUG_FORMS.map((f) => ({ value: f, label: capitalise(f) }));
const ROUTE_OPTIONS = optionsOf(DRUG_ROUTES, DRUG_ROUTE_LABELS);
const FREQUENCY_OPTIONS = DRUG_FREQUENCIES.map((f) => ({
  value: f,
  label: f === 'other' ? 'Other (describe)' : `${f} – ${DRUG_FREQUENCY_LABELS[f]}`,
}));
const TIMING_OPTIONS = (Object.keys(DRUG_TIMING_LABELS) as DrugTiming[]).map((t) => ({
  value: t,
  label: DRUG_TIMING_LABELS[t],
}));

const NOTICE = 'Allergy check is a convenience check, not clinical decision support.';

/**
 * The prescription editor (spec §4.7, §6.16): one card per drug – formulary autocomplete (free
 * text allowed), generic name, strength, form, dose, route, frequency (code + label; 'other'
 * asks for text), timing, duration, quantity, instructions; add, remove and reorder. Allergy
 * warnings from the server show on the row with an acknowledgement checkbox. Autosaved.
 */
export default function PrescriptionEditor({
  draft,
  server,
}: {
  draft: PrescriptionDraft;
  server: Prescription | null;
}) {
  const { local, problems, change, saveNow, dirty } = draft;
  const rows = local.rows;
  const save = () => void saveNow();
  const setRows = (next: RxRow[]) => change({ ...local, rows: next });
  const update = (i: number, patch: Partial<RxRow>) =>
    setRows(rows.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  const move = (i: number, by: number) => {
    const next = [...rows];
    const [row] = next.splice(i, 1);
    next.splice(i + by, 0, row!);
    setRows(next);
  };
  const pick = (i: number, d: FormularyDrug) => {
    const r = rows[i]!;
    update(i, {
      drugName: d.name,
      genericName: d.genericName,
      strength: r.strength || d.strengths[0] || null,
      form: r.form || d.forms[0] || null,
      route: d.route,
      dose: r.dose || d.doseHint,
      frequency: r.frequency || d.frequencyHint,
      // A different drug needs its own allergy acknowledgement.
      acknowledgeAllergy: undefined,
    });
  };

  return (
    <div className="space-y-4">
      <p className="flex items-center gap-1.5 text-xs text-muted">
        <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" /> {NOTICE}
      </p>
      {rows.length === 0 && <p className="text-sm text-muted">No drugs added yet.</p>}
      <ol id="rx-items" className="space-y-3" aria-label="Prescription drugs">
        {rows.map((row, i) => {
          const warning = warningFor(server, row, i, dirty);
          const acknowledged = row.acknowledgeAllergy ?? warning?.acknowledged ?? false;
          const p = problems[i] ?? {};
          return (
            <li
              key={row.key}
              id={`rx-item-${i}`}
              tabIndex={-1}
              aria-label={`Drug ${i + 1}${row.drugName ? `: ${row.drugName}` : ''}`}
              className={`space-y-3 rounded-control border p-3 focus-visible:outline-2 focus-visible:outline-primary-600 ${
                warning && !acknowledged ? 'border-danger-500 bg-danger-50' : 'border-line'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-ink">Drug {i + 1}</p>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Move drug ${i + 1} up`}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  >
                    <ArrowUp className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Move drug ${i + 1} down`}
                    disabled={i === rows.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDown className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove drug ${i + 1}`}
                    onClick={() => setRows(rows.filter((_, n) => n !== i))}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              </div>
              {warning && (
                <div
                  role="group"
                  aria-label="Allergy warning"
                  className="rounded-control bg-danger-600 px-3 py-2 text-sm text-white"
                >
                  <p className="flex items-center gap-1.5 font-semibold">
                    <TriangleAlert className="h-4 w-4" aria-hidden="true" />
                    Matches the recorded allergy “{warning.substance}”
                    {warning.drugClass ? ` (${warning.drugClass})` : ''}
                  </p>
                  <label className="mt-1 inline-flex min-h-11 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={acknowledged}
                      onChange={(e) => {
                        update(i, { acknowledgeAllergy: e.target.checked });
                        setTimeout(save, 0);
                      }}
                      className="h-4 w-4 accent-white"
                    />
                    I have reviewed this allergy warning
                  </label>
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <DrugNameInput
                  value={row.drugName}
                  error={p.drugName}
                  onText={(t) => update(i, { drugName: t, acknowledgeAllergy: undefined })}
                  onPick={(d) => pick(i, d)}
                  onBlur={save}
                />
                <Input
                  label="Generic name"
                  value={row.genericName ?? ''}
                  maxLength={RX_TEXT_LIMITS.genericName}
                  onChange={(e) => update(i, { genericName: e.target.value })}
                  onBlur={save}
                />
                <Input
                  label="Strength"
                  placeholder="500 mg"
                  value={row.strength ?? ''}
                  maxLength={RX_TEXT_LIMITS.strength}
                  onChange={(e) => update(i, { strength: e.target.value })}
                  onBlur={save}
                />
                <Select
                  label="Form"
                  placeholder="Choose"
                  options={FORM_OPTIONS}
                  value={row.form ?? ''}
                  onChange={(e) => update(i, { form: e.target.value || null })}
                  onBlur={save}
                />
                <Input
                  id={`rx-${i}-dose`}
                  label="Dose"
                  placeholder="1 tablet"
                  value={row.dose ?? ''}
                  maxLength={RX_TEXT_LIMITS.dose}
                  onChange={(e) => update(i, { dose: e.target.value })}
                  onBlur={save}
                />
                <Select
                  label="Route"
                  placeholder="Choose"
                  options={ROUTE_OPTIONS}
                  value={row.route ?? ''}
                  onChange={(e) => update(i, { route: e.target.value || null })}
                  onBlur={save}
                />
                <Select
                  id={`rx-${i}-frequency`}
                  label="Frequency"
                  placeholder="Choose"
                  options={FREQUENCY_OPTIONS}
                  value={row.frequency ?? ''}
                  onChange={(e) =>
                    update(i, { frequency: (e.target.value || null) as DrugFrequency | null })
                  }
                  onBlur={save}
                />
                {row.frequency === 'other' && (
                  <Input
                    id={`rx-${i}-frequencyText`}
                    label="Frequency (describe)"
                    placeholder="Every 6 hours"
                    value={row.frequencyText ?? ''}
                    error={p.frequencyText}
                    maxLength={RX_TEXT_LIMITS.frequencyText}
                    onChange={(e) => update(i, { frequencyText: e.target.value })}
                    onBlur={save}
                  />
                )}
                <Select
                  label="Timing"
                  placeholder="Choose"
                  options={TIMING_OPTIONS}
                  value={row.timing ?? ''}
                  onChange={(e) =>
                    update(i, { timing: (e.target.value || null) as DrugTiming | null })
                  }
                  onBlur={save}
                />
                <Input
                  id={`rx-${i}-durationDays`}
                  label="Duration (days)"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={MAX_DURATION_DAYS}
                  value={row.durationDays ?? ''}
                  onChange={(e) => {
                    const n = e.target.value === '' ? null : Math.round(Number(e.target.value));
                    if (n === null || (n >= 1 && n <= MAX_DURATION_DAYS))
                      update(i, { durationDays: n });
                  }}
                  onBlur={save}
                />
                <Input
                  label="Quantity"
                  placeholder="15 tablets"
                  value={row.quantity ?? ''}
                  maxLength={RX_TEXT_LIMITS.quantity}
                  onChange={(e) => update(i, { quantity: e.target.value })}
                  onBlur={save}
                />
                <Input
                  label="Instructions"
                  placeholder="After breakfast"
                  value={row.instructions ?? ''}
                  maxLength={RX_TEXT_LIMITS.instructions}
                  className="sm:col-span-2 lg:col-span-3"
                  onChange={(e) => update(i, { instructions: e.target.value })}
                  onBlur={save}
                />
              </div>
            </li>
          );
        })}
      </ol>
      <Button
        variant="secondary"
        size="sm"
        disabled={rows.length >= MAX_PRESCRIPTION_ITEMS}
        onClick={() => setRows([...rows, blankRow()])}
      >
        <Plus className="h-4 w-4" aria-hidden="true" /> Add drug
      </Button>
      <Textarea
        label="General instructions"
        autoGrow
        maxLength={RX_TEXT_LIMITS.generalInstructions}
        value={local.generalInstructions}
        onChange={(e) => change({ ...local, generalInstructions: e.target.value })}
        onBlur={save}
      />
      <div>
        <p className="text-sm font-medium text-ink">Preview</p>
        <pre
          aria-label="Prescription preview"
          className="mt-1.5 rounded-control border border-line bg-surface-muted p-3 font-sans text-sm whitespace-pre-wrap text-ink"
        >
          {previewText(local)}
        </pre>
      </div>
    </div>
  );
}
