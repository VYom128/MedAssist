import { LAB_ORDER_RULES, type LabFlag } from '../../config/constants.js';
import {
  computeFlag,
  isCriticalFlag,
  referenceText,
  selectRange,
  type ParameterLike,
  type Subject,
} from './ranges.js';

/**
 * Building an item's stored results from what a lab technician sent (spec §7.14, §8.7): each
 * value is checked against its catalogue parameter and the SERVER computes the flag and the
 * reference text (with the patient's sex and age at collection). Pure – no database.
 */

export interface ResultInput {
  parameterKey: string;
  value: unknown;
}

export interface CatalogueParameter extends ParameterLike {
  name: string;
}

export interface BuiltResult {
  parameterKey: string;
  name: string;
  unit?: string;
  value: number | string;
  referenceText?: string;
  flag: LabFlag;
}

export interface FieldIssue {
  field: string;
  message: string;
}

const isBlank = (v: unknown) => v === null || v === undefined || v === '';

/** The value as stored, or an error message. */
function checkValue(p: CatalogueParameter, value: unknown): number | string | { error: string } {
  if (p.valueType === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return { error: 'Enter a number' };
    if (Math.abs(value) > LAB_ORDER_RULES.numericValueMax) return { error: 'Value out of range' };
    return value;
  }
  if (typeof value !== 'string') return { error: 'Enter text' };
  const text = value.trim();
  if (p.valueType === 'option') {
    return (p.options ?? []).includes(text) ? text : { error: 'Choose one of the options' };
  }
  if (text.length > LAB_ORDER_RULES.textValueMax) {
    return { error: `At most ${LAB_ORDER_RULES.textValueMax} characters` };
  }
  return text;
}

/**
 * The stored results for `input` in catalogue order. Blank values are left out (a partial
 * save). `issues` are field errors (paths like `body.results.2.value`); `missing` lists the
 * parameter keys still without a value; `critical` counts critical flags.
 */
export function buildResults(
  parameters: readonly CatalogueParameter[],
  input: readonly ResultInput[],
  subject: Subject,
) {
  const issues: FieldIssue[] = [];
  const byKey = new Map<string, unknown>();
  input.forEach((r, i) => {
    const at = `body.results.${i}`;
    if (!parameters.some((p) => p.key === r.parameterKey)) {
      issues.push({ field: `${at}.parameterKey`, message: 'Not a parameter of this test' });
    } else if (byKey.has(r.parameterKey)) {
      issues.push({ field: `${at}.parameterKey`, message: 'Given twice' });
    } else {
      byKey.set(r.parameterKey, r.value);
    }
  });

  const results: BuiltResult[] = [];
  const missing: string[] = [];
  for (const p of parameters) {
    const raw = byKey.get(p.key);
    if (isBlank(raw) || (typeof raw === 'string' && raw.trim() === '')) {
      missing.push(p.key);
      continue;
    }
    const checked = checkValue(p, raw);
    if (typeof checked === 'object') {
      const index = input.findIndex((r) => r.parameterKey === p.key);
      issues.push({ field: `body.results.${index}.value`, message: checked.error });
      continue;
    }
    const range = selectRange(p, subject);
    const reference = referenceText(p, range);
    results.push({
      parameterKey: p.key,
      name: p.name,
      ...(p.unit ? { unit: p.unit } : {}),
      value: checked,
      ...(reference ? { referenceText: reference } : {}),
      flag: computeFlag(checked, p, range),
    });
  }
  const critical = results.filter((r) => isCriticalFlag(r.flag)).length;
  return { results, missing, issues, critical };
}
