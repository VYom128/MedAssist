import { z } from 'zod';
import {
  LAB_SAMPLE_TYPES,
  LAB_TEST_CATEGORIES,
  LAB_VALUE_TYPES,
  RANGE_GENDERS,
} from '../../config/constants.js';
import { booleanQuery, idParams, optionalText, paginationQuery, paise } from '../../utils/zod.js';

const age = z.number().int('Whole years').min(0).max(150);
const value = z.number().finite();

const range = z.strictObject({
  gender: z.enum(RANGE_GENDERS).default('any'),
  ageMinYears: age.optional(),
  ageMaxYears: age.optional(),
  low: value.optional(),
  high: value.optional(),
  criticalLow: value.optional(),
  criticalHigh: value.optional(),
  text: z.string().trim().min(1).max(100).optional(),
});

const parameter = z.strictObject({
  key: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{0,29}$/, 'Lower-case letters, digits and _ (e.g. hb, wbc_count)'),
  name: z.string().trim().min(1, 'Required').max(80),
  unit: z.string().trim().max(20).optional(),
  valueType: z.enum(LAB_VALUE_TYPES),
  options: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  ranges: z.array(range).max(20).optional(),
});

export type ParameterInput = z.infer<typeof parameter>;
type RangeInput = z.infer<typeof range>;

export interface ParameterIssue {
  path: (string | number)[];
  message: string;
}

const band = (r: RangeInput) => [r.ageMinYears ?? 0, r.ageMaxYears ?? Infinity] as const;
const bandLabel = (r: RangeInput) =>
  `${r.gender}, ages ${r.ageMinYears ?? 0}–${r.ageMaxYears ?? 'any'}`;

/** Checks one numeric reference range: low < high, criticalLow ≤ low, high ≤ criticalHigh, ages. */
function rangeIssues(r: RangeInput, at: (string | number)[]): ParameterIssue[] {
  const issues: ParameterIssue[] = [];
  const add = (field: string, message: string) => issues.push({ path: [...at, field], message });
  if (r.low === undefined && r.high === undefined && r.text === undefined) {
    issues.push({ path: at, message: 'Give low, high or a reference text' });
  }
  if (r.low !== undefined && r.high !== undefined && !(r.low < r.high))
    add('high', 'Must be greater than low');
  if (r.criticalLow !== undefined && r.low !== undefined && !(r.criticalLow <= r.low)) {
    add('criticalLow', 'Must be at most low');
  }
  if (r.criticalHigh !== undefined && r.high !== undefined && !(r.high <= r.criticalHigh)) {
    add('criticalHigh', 'Must be at least high');
  }
  if (
    r.criticalLow !== undefined &&
    r.criticalHigh !== undefined &&
    !(r.criticalLow < r.criticalHigh)
  ) {
    add('criticalHigh', 'Must be greater than criticalLow');
  }
  if (r.ageMinYears !== undefined && r.ageMaxYears !== undefined && r.ageMinYears > r.ageMaxYears) {
    add('ageMaxYears', 'Must be at least ageMinYears');
  }
  return issues;
}

/**
 * Catalogue rules beyond field types (spec §6.19): at least one parameter; keys unique; 'option'
 * needs 2+ distinct options and no ranges; 'text' has neither; numeric ranges are consistent, and
 * ranges for the same gender must not overlap in age (ages inclusive). An 'any' range may sit
 * alongside male/female ones: Phase 6 prefers the specific gender.
 * Paths are relative to the body (`parameters.0.ranges.1.high`).
 */
export function parameterIssues(parameters: ParameterInput[]): ParameterIssue[] {
  const issues: ParameterIssue[] = [];
  if (parameters.length === 0) {
    return [{ path: ['parameters'], message: 'Add at least one parameter' }];
  }
  const keys = new Set<string>();
  parameters.forEach((p, i) => {
    const at = ['parameters', i];
    if (keys.has(p.key))
      issues.push({ path: [...at, 'key'], message: `Key "${p.key}" is used twice` });
    keys.add(p.key);

    const options = p.options ?? [];
    const ranges = p.ranges ?? [];
    if (p.valueType === 'option') {
      if (new Set(options).size < 2) {
        issues.push({ path: [...at, 'options'], message: 'Give at least 2 different options' });
      } else if (new Set(options).size !== options.length) {
        issues.push({ path: [...at, 'options'], message: 'Options must not repeat' });
      }
    } else if (options.length > 0) {
      issues.push({ path: [...at, 'options'], message: 'Only option parameters have options' });
    }
    if (p.valueType !== 'number' && ranges.length > 0) {
      issues.push({ path: [...at, 'ranges'], message: 'Only number parameters have ranges' });
      return;
    }

    ranges.forEach((r, j) => issues.push(...rangeIssues(r, [...at, 'ranges', j])));
    ranges.forEach((r, j) => {
      const [min, max] = band(r);
      const clash = ranges.findIndex((o, k) => {
        if (k >= j || o.gender !== r.gender) return false;
        const [oMin, oMax] = band(o);
        return min <= oMax && oMin <= max;
      });
      if (clash >= 0) {
        issues.push({
          path: [...at, 'ranges', j],
          message: `Overlaps the ${bandLabel(ranges[clash]!)} range`,
        });
      }
    });
  });
  return issues;
}

const code = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9-]{1,19}$/, 'Use 2–20 letters, digits or dashes');

const fields = {
  code,
  name: z.string().trim().min(2, 'At least 2 characters').max(120),
  category: z.enum(LAB_TEST_CATEGORIES),
  sampleType: z.enum(LAB_SAMPLE_TYPES),
  pricePaise: paise,
  turnaroundHours: z.number().int('Whole hours').min(1).max(720).nullable(),
  preparation: optionalText(300),
  parameters: z.array(parameter).max(50, 'At most 50 parameters'),
};

/** Cross-field rules; skipped while `parameters` itself is malformed (Zod reports that). */
const checkParameters = (body: { parameters?: unknown }, ctx: z.RefinementCtx) => {
  if (body.parameters === undefined) return;
  const parsed = fields.parameters.safeParse(body.parameters);
  if (!parsed.success) return;
  for (const issue of parameterIssues(parsed.data)) {
    ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
  }
};

export const listLabTestsSchema = {
  query: z.object({
    ...paginationQuery,
    category: z.enum(LAB_TEST_CATEGORIES).optional(),
    q: z.string().trim().min(1).max(100).optional(),
    /** Admins only; ignored for everyone else. */
    includeInactive: booleanQuery,
  }),
};

export const createLabTestSchema = {
  body: z
    .strictObject({
      ...fields,
      turnaroundHours: fields.turnaroundHours.optional(),
    })
    .superRefine(checkParameters),
};

/** PATCH /lab-tests/:id – `parameters`, when sent, replaces the whole list. */
export const updateLabTestSchema = {
  params: idParams,
  body: z
    .strictObject({
      code: fields.code.optional(),
      name: fields.name.optional(),
      category: fields.category.optional(),
      sampleType: fields.sampleType.optional(),
      pricePaise: fields.pricePaise.optional(),
      turnaroundHours: fields.turnaroundHours.optional(),
      preparation: fields.preparation,
      parameters: fields.parameters.optional(),
    })
    .refine((b) => Object.keys(b).length > 0, 'Nothing to update')
    .superRefine(checkParameters),
};

export const labTestIdSchema = { params: idParams };

export type ListLabTestsQuery = z.infer<typeof listLabTestsSchema.query>;
export type CreateLabTestInput = z.infer<typeof createLabTestSchema.body>;
export type UpdateLabTestInput = z.infer<typeof updateLabTestSchema.body>;
