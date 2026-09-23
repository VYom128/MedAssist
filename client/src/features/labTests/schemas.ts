import { z } from 'zod';
import {
  LAB_SAMPLE_TYPES,
  LAB_TEST_CATEGORIES,
  LAB_VALUE_TYPES,
  RANGE_GENDERS,
} from '../../constants/catalog';
import { paiseField } from '../services/schemas';
import type { LabTest, LabTestInput, ReferenceRange } from './api';

// Mirrors server/src/modules/labTests/validation.ts (parameterIssues). Number boxes are text in
// the form ('' = not set) and become numbers on submit.

const decimal = /^-?\d+(\.\d+)?$/;
const optionalNumber = z
  .string()
  .trim()
  .refine((v) => v === '' || decimal.test(v), 'Enter a number');
const optionalAge = z
  .string()
  .trim()
  .refine((v) => v === '' || (/^\d+$/.test(v) && Number(v) <= 150), '0–150');

const rangeSchema = z.object({
  gender: z.enum(RANGE_GENDERS),
  ageMinYears: optionalAge,
  ageMaxYears: optionalAge,
  low: optionalNumber,
  high: optionalNumber,
  criticalLow: optionalNumber,
  criticalHigh: optionalNumber,
  text: z.string().trim().max(100, 'At most 100 characters'),
});

const parameterSchema = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{0,29}$/, 'Lower-case letters, digits and _ (e.g. hb)'),
  name: z.string().trim().min(1, 'Required').max(80, 'At most 80 characters'),
  unit: z.string().trim().max(20, 'At most 20 characters'),
  valueType: z.enum(LAB_VALUE_TYPES),
  options: z.array(z.string()),
  ranges: z.array(rangeSchema).max(20, 'At most 20 ranges'),
});

export type RangeForm = z.infer<typeof rangeSchema>;
export type ParameterForm = z.infer<typeof parameterSchema>;

const n = (v: string) => (v.trim() === '' ? undefined : Number(v));

export const labTestSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9][A-Z0-9-]{1,19}$/, 'Use 2–20 letters, digits or dashes'),
    name: z.string().trim().min(2, 'At least 2 characters').max(120, 'At most 120 characters'),
    category: z.enum(LAB_TEST_CATEGORIES),
    sampleType: z.enum(LAB_SAMPLE_TYPES),
    pricePaise: paiseField(),
    turnaroundHours: z
      .string()
      .trim()
      .refine(
        (v) => v === '' || (/^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 720),
        '1–720 hours',
      ),
    preparation: z.string().trim().max(300, 'At most 300 characters'),
    parameters: z.array(parameterSchema).max(50, 'At most 50 parameters'),
  })
  .superRefine((form, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: 'custom', path, message });
    if (form.parameters.length === 0) issue(['parameters'], 'Add at least one parameter');

    const keys = new Set<string>();
    form.parameters.forEach((p, i) => {
      const at = ['parameters', i];
      if (p.key && keys.has(p.key)) issue([...at, 'key'], `Key "${p.key}" is used twice`);
      keys.add(p.key);

      if (p.valueType === 'option') {
        if (new Set(p.options).size < 2)
          issue([...at, 'options'], 'Give at least 2 different options');
      }
      if (p.valueType !== 'number') return; // ranges are only kept for number parameters

      p.ranges.forEach((r, j) => {
        const rat = [...at, 'ranges', j];
        const [low, high, cLow, cHigh] = [n(r.low), n(r.high), n(r.criticalLow), n(r.criticalHigh)];
        const [aMin, aMax] = [n(r.ageMinYears), n(r.ageMaxYears)];
        if (low === undefined && high === undefined && !r.text) {
          issue([...rat, 'low'], 'Give low, high or a reference text');
        }
        if (low !== undefined && high !== undefined && !(low < high)) {
          issue([...rat, 'high'], 'Must be greater than low');
        }
        if (cLow !== undefined && low !== undefined && !(cLow <= low)) {
          issue([...rat, 'criticalLow'], 'Must be at most low');
        }
        if (cHigh !== undefined && high !== undefined && !(high <= cHigh)) {
          issue([...rat, 'criticalHigh'], 'Must be at least high');
        }
        if (cLow !== undefined && cHigh !== undefined && !(cLow < cHigh)) {
          issue([...rat, 'criticalHigh'], 'Must be greater than critical low');
        }
        if (aMin !== undefined && aMax !== undefined && aMin > aMax) {
          issue([...rat, 'ageMaxYears'], 'Must be at least the minimum age');
        }
        // Same-gender ranges must not overlap in age (inclusive whole years).
        const band = (x: RangeForm) =>
          [n(x.ageMinYears) ?? 0, n(x.ageMaxYears) ?? Infinity] as const;
        const [min, max] = band(r);
        const clash = p.ranges.findIndex((o, k) => {
          if (k >= j || o.gender !== r.gender) return false;
          const [oMin, oMax] = band(o);
          return min <= oMax && oMin <= max;
        });
        if (clash >= 0) {
          issue([...rat, 'gender'], `Overlaps range ${clash + 1} (same gender and ages)`);
        }
      });
    });
  });

export type LabTestFormInput = z.input<typeof labTestSchema>;
export type LabTestFormValues = z.output<typeof labTestSchema>;

export const emptyRange = (): RangeForm => ({
  gender: 'any',
  ageMinYears: '',
  ageMaxYears: '',
  low: '',
  high: '',
  criticalLow: '',
  criticalHigh: '',
  text: '',
});

export const emptyParameter = (): ParameterForm => ({
  key: '',
  name: '',
  unit: '',
  valueType: 'number',
  options: [],
  ranges: [emptyRange()],
});

export const emptyLabTest = (): LabTestFormInput => ({
  code: '',
  name: '',
  category: 'haematology',
  sampleType: 'blood',
  pricePaise: null,
  turnaroundHours: '',
  preparation: '',
  parameters: [emptyParameter()],
});

const str = (v: number | undefined) => (v === undefined || v === null ? '' : String(v));

export function toLabTestForm(t: LabTest): LabTestFormInput {
  return {
    code: t.code,
    name: t.name,
    category: t.category,
    sampleType: t.sampleType,
    pricePaise: t.pricePaise,
    turnaroundHours: t.turnaroundHours === null ? '' : String(t.turnaroundHours),
    preparation: t.preparation ?? '',
    parameters: t.parameters.map((p) => ({
      key: p.key,
      name: p.name,
      unit: p.unit ?? '',
      valueType: p.valueType,
      options: [...p.options],
      ranges: p.ranges.map((r) => ({
        gender: r.gender,
        ageMinYears: str(r.ageMinYears),
        ageMaxYears: str(r.ageMaxYears),
        low: str(r.low),
        high: str(r.high),
        criticalLow: str(r.criticalLow),
        criticalHigh: str(r.criticalHigh),
        text: r.text ?? '',
      })),
    })),
  };
}

/** Form → API: empty boxes dropped; options only for 'option', ranges only for 'number'. */
export function toLabTestInput(v: LabTestFormValues): LabTestInput {
  return {
    code: v.code,
    name: v.name,
    category: v.category,
    sampleType: v.sampleType,
    pricePaise: v.pricePaise ?? 0,
    turnaroundHours: v.turnaroundHours === '' ? null : Number(v.turnaroundHours),
    preparation: v.preparation,
    parameters: v.parameters.map((p) => ({
      key: p.key,
      name: p.name,
      ...(p.unit ? { unit: p.unit } : {}),
      valueType: p.valueType,
      ...(p.valueType === 'option' ? { options: p.options } : {}),
      ...(p.valueType === 'number'
        ? {
            ranges: p.ranges.map((r) => {
              const range: ReferenceRange = { gender: r.gender };
              for (const f of [
                'ageMinYears',
                'ageMaxYears',
                'low',
                'high',
                'criticalLow',
                'criticalHigh',
              ] as const) {
                const value = n(r[f]);
                if (value !== undefined) range[f] = value;
              }
              if (r.text) range.text = r.text;
              return range;
            }),
          }
        : {}),
    })),
  };
}
