import { useState, type FormEvent, type ReactNode } from 'react';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Textarea from '../../../components/ui/Textarea';
import { LAB_RULES } from '../../../constants/catalog';
import { isApiQueryError } from '../../../utils/http';
import type { LabParameter } from '../../labTests/api';
import type { LabResult, ResultInput } from '../api';
import { computeFlag, referenceText, selectRange, type Subject } from '../ranges';
import { LabFlagPill } from './LabBadges';

type Values = Record<string, string>;

const initialValues = (parameters: LabParameter[], results: LabResult[]): Values =>
  Object.fromEntries(
    parameters.map((p) => {
      const r = results.find((x) => x.parameterKey === p.key);
      return [p.key, r?.value === null || r?.value === undefined ? '' : String(r.value)];
    }),
  );

/** The typed value as sent: numbers parsed, blanks null. `undefined` = not a number. */
function parse(p: LabParameter, raw: string): number | string | null | undefined {
  const text = raw.trim();
  if (text === '') return null;
  if (p.valueType !== 'number') return text;
  const n = Number(text.replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

/**
 * One test's results (spec §13.4 #6 "results entry grid with live flagging"): an input per
 * parameter (number, option list or text) with its unit and the reference range for this patient
 * (sex, age at collection), a live flag preview, and remarks. The server checks the values again
 * and stores its own flags. `requireAll` (revisions) asks for every parameter first.
 */
export default function ItemResultsForm({
  idPrefix,
  parameters,
  results,
  remarks: initialRemarks,
  subject,
  submitLabel,
  saving,
  requireAll = false,
  extra,
  onSubmit,
}: {
  idPrefix: string;
  parameters: LabParameter[];
  results: LabResult[];
  remarks: string | null;
  subject: Subject;
  submitLabel: string;
  saving: boolean;
  requireAll?: boolean;
  /** More fields above the submit button (e.g. a revision reason). */
  extra?: ReactNode;
  onSubmit: (results: ResultInput[], remarks: string | null) => Promise<unknown>;
}) {
  const [values, setValues] = useState<Values>(() => initialValues(parameters, results));
  const [remarks, setRemarks] = useState(initialRemarks ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const filled = parameters.filter((p) => values[p.key]?.trim()).length;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found: Record<string, string> = {};
    const sent: ResultInput[] = [];
    for (const p of parameters) {
      const value = parse(p, values[p.key] ?? '');
      if (value === undefined) found[p.key] = 'Enter a number';
      else if (value === null && requireAll) found[p.key] = 'Required for a revision';
      else sent.push({ parameterKey: p.key, value });
    }
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    try {
      await onSubmit(sent, remarks.trim() ? remarks.trim() : null);
    } catch (err) {
      // Field errors from the server: body.results.<index>.value → that parameter.
      if (isApiQueryError(err) && Array.isArray(err.details)) {
        const server: Record<string, string> = {};
        for (const d of err.details as { field?: string; message?: string }[]) {
          const index = /^body\.results\.(\d+)\./.exec(d.field ?? '')?.[1];
          const key = index !== undefined ? sent[Number(index)]?.parameterKey : undefined;
          if (key) server[key] = d.message ?? 'Check this value';
        }
        setErrors(server);
      }
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="space-y-4">
      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
        {parameters.map((p) => {
          const range = selectRange(p, subject);
          const reference = referenceText(p, range);
          const parsed = parse(p, values[p.key] ?? '');
          const flag = parsed === undefined ? null : computeFlag(parsed, p, range);
          const id = `${idPrefix}-${p.key}`;
          const hint = (
            <span className="flex flex-wrap items-center gap-2">
              {reference ? <span>Ref. {reference}</span> : null}
              <LabFlagPill flag={flag} />
            </span>
          );
          const onChange = (v: string) => setValues((prev) => ({ ...prev, [p.key]: v }));
          return p.valueType === 'option' ? (
            <Select
              key={p.key}
              id={id}
              label={p.name}
              hint={hint}
              error={errors[p.key]}
              placeholder="Choose…"
              options={p.options.map((o) => ({ value: o, label: o }))}
              value={values[p.key] ?? ''}
              onChange={(e) => onChange(e.target.value)}
            />
          ) : (
            <Input
              key={p.key}
              id={id}
              label={p.name}
              hint={hint}
              error={errors[p.key]}
              inputMode={p.valueType === 'number' ? 'decimal' : undefined}
              maxLength={p.valueType === 'text' ? LAB_RULES.textValueMax : 20}
              autoComplete="off"
              trailing={p.unit ? <span className="text-xs text-muted">{p.unit}</span> : undefined}
              value={values[p.key] ?? ''}
              onChange={(e) => onChange(e.target.value)}
            />
          );
        })}
      </div>
      <Textarea
        id={`${idPrefix}-remarks`}
        label="Remarks (optional)"
        hint="Internal – seen by the lab and doctors, not printed on the report or shown to the patient."
        maxLength={LAB_RULES.remarksMax}
        rows={2}
        value={remarks}
        onChange={(e) => setRemarks(e.target.value)}
      />
      {extra}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted" aria-live="polite">
          {filled} of {parameters.length} parameters filled
        </p>
        <Button type="submit" loading={saving}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
