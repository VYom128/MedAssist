import { useState } from 'react';
import Input from '../../../components/ui/Input';
import { BMI_USUAL, VITALS, VITAL_KEYS, type VitalKey } from '../../../constants/catalog';
import type { NoteChanges, Vitals } from '../api';
import { computeBmi, fieldId } from '../fields';

const outside = (value: number | null, usual?: [number, number]) =>
  value !== null && usual !== undefined && (value < usual[0] || value > usual[1]);

/**
 * One vital: a number within the server's range (§6.13). The text is kept locally while typing;
 * only valid numbers (or an empty field = cleared) reach the note. Values outside the usual adult
 * range are highlighted – a display hint, never a block.
 */
function VitalInput({
  name,
  value,
  onChange,
  onBlur,
  readOnly,
}: {
  name: VitalKey;
  value: number | null;
  /** `undefined` = the text is not a valid value (any pending change is dropped). */
  onChange: (v: number | null | undefined) => void;
  onBlur?: () => void;
  readOnly?: boolean;
}) {
  const spec = VITALS[name];
  const [text, setText] = useState(value === null ? '' : String(value));
  const [seen, setSeen] = useState(value);
  const [focused, setFocused] = useState(false);
  // Follow outside changes (reload after a conflict) – never while the doctor is typing here.
  if (value !== seen && !focused) {
    setSeen(value);
    setText(value === null ? '' : String(value));
  }
  const parsed = text.trim() === '' ? null : Number(text);
  const invalid =
    parsed !== null && (Number.isNaN(parsed) || parsed < spec.min || parsed > spec.max);
  const unusual = !invalid && outside(parsed, spec.usual);

  return (
    <Input
      id={fieldId(`vitals.${name}`)}
      label={`${spec.label} (${spec.unit})`}
      type="number"
      inputMode="decimal"
      step={spec.step}
      min={spec.min}
      max={spec.max}
      value={text}
      readOnly={readOnly}
      error={invalid ? `Between ${spec.min} and ${spec.max}` : undefined}
      hint={
        unusual ? (
          <span className="font-medium text-warning-700">Outside the usual range</span>
        ) : undefined
      }
      className={unusual ? '[&_input]:border-warning-500 [&_input]:bg-warning-50' : ''}
      onChange={(e) => {
        const next = e.target.value;
        setText(next);
        const n = next.trim() === '' ? null : Number(next);
        if (n === null) onChange(null);
        else if (!Number.isNaN(n) && n >= spec.min && n <= spec.max) onChange(n);
        else onChange(undefined);
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        setSeen(value);
        onBlur?.();
      }}
    />
  );
}

/** Vitals with a live BMI (the server computes the stored one the same way). */
export default function VitalsFields({
  vitals,
  onChange,
  onBlur,
  readOnly,
}: {
  vitals: Vitals;
  onChange: (changes: NoteChanges) => void;
  onBlur?: () => void;
  readOnly?: boolean;
}) {
  const bmi = computeBmi(vitals.weightKg, vitals.heightCm);
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {VITAL_KEYS.map((key) => (
          <VitalInput
            key={key}
            name={key}
            value={vitals[key]}
            readOnly={readOnly}
            onBlur={onBlur}
            onChange={(v) => onChange({ vitals: { [key]: v } })}
          />
        ))}
      </div>
      <p className="text-sm" aria-live="polite">
        <span className="text-muted">BMI: </span>
        {bmi === null ? (
          <span className="text-muted">enter weight and height</span>
        ) : (
          <span
            className={`tabular font-semibold ${outside(bmi, BMI_USUAL) ? 'text-warning-700' : 'text-ink'}`}
          >
            {bmi} kg/m²{outside(bmi, BMI_USUAL) ? ' (outside 18.5–24.9)' : ''}
          </span>
        )}
      </p>
    </div>
  );
}
