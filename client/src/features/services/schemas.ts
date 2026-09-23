import { z } from 'zod';
import { SERVICE_TYPES } from '../../constants/catalog';
import { percentToBps } from '../../utils/money';

/** Money typed in rupees by MoneyInput: integer paise (null = empty, NaN = not an amount). */
export const paiseField = (required = true) =>
  z
    .number({ error: 'Enter an amount in rupees' })
    .nullable()
    .refine((v) => !required || v !== null, 'Enter an amount in rupees')
    .refine((v) => v === null || (Number.isInteger(v) && v >= 0), 'Enter an amount in rupees');

// Mirrors server/src/modules/services/validation.ts. Tax is typed as a percentage ('' = clinic
// default) and sent as basis points.
export const serviceSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9-]{1,19}$/, 'Use 2–20 letters, digits or dashes'),
  name: z.string().trim().min(2, 'At least 2 characters').max(120, 'At most 120 characters'),
  department: z.string(),
  type: z.enum(SERVICE_TYPES, 'Choose a type'),
  durationMinutes: z
    .number({ error: 'Enter minutes' })
    .int('Whole minutes')
    .min(5, 'At least 5 minutes')
    .max(240, 'At most 240 minutes'),
  pricePaise: paiseField(),
  taxPercent: z
    .string()
    .trim()
    .refine(
      (v) => v === '' || (/^\d{1,3}(\.\d{1,2})?$/.test(v) && Number(v) <= 100),
      'A percentage from 0 to 100 (at most 2 decimals), or empty for the clinic default',
    ),
});

export type ServiceFormInput = z.input<typeof serviceSchema>;
export type ServiceFormValues = z.output<typeof serviceSchema>;

/** Form values → API body. */
export const toServiceInput = (v: ServiceFormValues) => ({
  code: v.code,
  name: v.name,
  department: v.department || null,
  type: v.type,
  durationMinutes: v.durationMinutes,
  pricePaise: v.pricePaise ?? 0,
  taxRateBps: v.taxPercent === '' ? null : percentToBps(Number(v.taxPercent)),
});
