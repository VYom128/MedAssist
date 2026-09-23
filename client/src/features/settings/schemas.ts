import type { FieldNamesMarkedBoolean } from 'react-hook-form';
import { z } from 'zod';
import { EXPLANATION_LANGUAGES, PAYMENT_METHODS } from '../../constants/catalog';
import { bpsToPercent, percentToBps } from '../../utils/money';
import type { AdminSettings, SettingsPatch } from './api';

// Mirrors server/src/modules/settings/validation.ts. The form shows tax as a percentage; the API
// stores basis points (1800 = 18 %).

const num = (min: number, max: number) =>
  z
    .number({ error: 'Enter a number' })
    .int('Use a whole number')
    .min(min, `At least ${min}`)
    .max(max, `At most ${max}`);

const text = (max: number) => z.string().trim().max(max, `At most ${max} characters`);
const optional = <T extends z.ZodType<string>>(schema: T) => z.union([z.literal(''), schema]);

const url = z
  .string()
  .trim()
  .refine((v) => /^https?:\/\/\S+\.\S+/.test(v), 'Enter a full http(s):// address');

let zones: Set<string> | undefined;
/** IANA names the browser knows, plus aliases such as Asia/Kolkata (ICU lists Asia/Calcutta). */
export function timezoneOptions(): string[] {
  zones ??= new Set(['UTC', 'Asia/Kolkata', ...Intl.supportedValuesOf('timeZone')]);
  return [...zones].sort();
}
export function isValidTimezone(value: string): boolean {
  if (timezoneOptions().includes(value)) return true;
  if (!/^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)+$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const unique = (a: readonly unknown[]) => new Set(a).size === a.length;

export const settingsSchema = z.object({
  name: z.string().trim().min(1, 'Required').max(120, 'At most 120 characters'),
  logoUrl: optional(url),
  tagline: text(160),
  registrationNumber: text(50),
  gstin: optional(
    z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Enter a valid 15-character GSTIN'),
  ),
  address: z.object({
    line1: text(120),
    line2: text(120),
    city: text(60),
    state: text(60),
    postalCode: optional(
      z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9 -]{3,10}$/, 'Enter a valid postal code'),
    ),
    country: text(60),
  }),
  phone: optional(
    z
      .string()
      .trim()
      .refine((v) => /^\+?\d{10,15}$/.test(v.replace(/[\s-]/g, '')), 'Enter a valid phone number'),
  ),
  email: optional(z.string().trim().pipe(z.email('Enter a valid email'))),
  website: optional(url),
  timezone: z.string().trim().refine(isValidTimezone, 'Choose a timezone from the list'),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code (e.g. INR)'),
  workingDays: z
    .array(num(0, 6))
    .min(1, 'Choose at least one working day')
    .refine(unique, 'Days must not repeat'),
  appointment: z.object({
    defaultSlotMinutes: num(5, 120),
    bookingWindowDays: num(1, 365),
    minCancelHours: num(0, 168),
    allowPatientSelfBooking: z.boolean(),
    maxActiveBookingsPerPatient: num(1, 20),
    walkInOverbookPerSession: num(0, 20),
    noShowGraceMinutes: num(0, 240),
    reminderHoursBefore: num(1, 168),
  }),
  billing: z.object({
    invoicePrefix: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2,6}$/, 'Use 2–6 letters'),
    defaultTaxRatePercent: z
      .number({ error: 'Enter a number' })
      .min(0, 'At least 0')
      .max(100, 'At most 100')
      .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-9, 'At most 2 decimals'),
    taxLabel: z.string().trim().min(1, 'Required').max(20, 'At most 20 characters'),
    maxDiscountPercentWithoutAdmin: num(0, 100),
    paymentMethods: z
      .array(z.enum(PAYMENT_METHODS))
      .min(1, 'Choose at least one payment method')
      .refine(unique, 'Methods must not repeat'),
    invoiceFooter: text(500),
  }),
  lab: z.object({ requireDualVerification: z.boolean(), criticalAlertEnabled: z.boolean() }),
  ai: z.object({
    enabled: z.boolean(),
    clinicalSummaryEnabled: z.boolean(),
    patientExplanationEnabled: z.boolean(),
    explanationLanguages: z
      .array(z.enum(EXPLANATION_LANGUAGES))
      .min(1, 'Choose at least one language'),
  }),
  notifications: z.object({ emailEnabled: z.boolean() }),
});

export type SettingsFormInput = z.input<typeof settingsSchema>;
export type SettingsFormValues = z.output<typeof settingsSchema>;

/** API settings → form values (nulls become '', tax becomes a percentage). */
export function toFormValues(s: AdminSettings): SettingsFormInput {
  const t = (v: string | null) => v ?? '';
  return {
    name: s.name,
    logoUrl: t(s.logoUrl),
    tagline: t(s.tagline),
    registrationNumber: t(s.registrationNumber),
    gstin: t(s.gstin),
    address: {
      line1: t(s.address.line1),
      line2: t(s.address.line2),
      city: t(s.address.city),
      state: t(s.address.state),
      postalCode: t(s.address.postalCode),
      country: t(s.address.country),
    },
    phone: t(s.phone),
    email: t(s.email),
    website: t(s.website),
    timezone: s.timezone,
    currency: s.currency,
    workingDays: [...s.workingDays],
    appointment: { ...s.appointment },
    billing: {
      invoicePrefix: s.billing.invoicePrefix,
      defaultTaxRatePercent: bpsToPercent(s.billing.defaultTaxRateBps),
      taxLabel: s.billing.taxLabel,
      maxDiscountPercentWithoutAdmin: s.billing.maxDiscountPercentWithoutAdmin,
      paymentMethods: [...s.billing.paymentMethods],
      invoiceFooter: t(s.billing.invoiceFooter),
    },
    lab: { ...s.lab },
    ai: { ...s.ai, explanationLanguages: [...s.ai.explanationLanguages] },
    notifications: { ...s.notifications },
  };
}

type Dirty = FieldNamesMarkedBoolean<SettingsFormInput>;

const isDirtyMark = (mark: unknown): boolean =>
  mark === true ||
  (Array.isArray(mark) && mark.some(isDirtyMark)) ||
  (typeof mark === 'object' && mark !== null && Object.values(mark).some(isDirtyMark));

/**
 * The PATCH body: only fields the user changed (arrays are sent whole), with the tax percentage
 * converted to basis points.
 */
export function buildPatch(values: SettingsFormValues, dirty: Partial<Dirty>): SettingsPatch {
  const pick = (source: Record<string, unknown>, marks: Record<string, unknown>) => {
    const out: Record<string, unknown> = {};
    for (const [key, mark] of Object.entries(marks)) {
      if (!isDirtyMark(mark)) continue;
      const value = source[key];
      const nested =
        typeof mark === 'object' && !Array.isArray(mark) && value && !Array.isArray(value);
      out[key] = nested
        ? pick(value as Record<string, unknown>, mark as Record<string, unknown>)
        : value;
    }
    return out;
  };
  const patch = pick(
    values as unknown as Record<string, unknown>,
    dirty as Record<string, unknown>,
  );
  const billing = patch.billing as Record<string, unknown> | undefined;
  if (billing && 'defaultTaxRatePercent' in billing) {
    billing.defaultTaxRateBps = percentToBps(billing.defaultTaxRatePercent as number);
    delete billing.defaultTaxRatePercent;
  }
  return patch as SettingsPatch;
}

/** Form fields per tab (for error markers and server error mapping). */
export const TAB_FIELDS = {
  clinic: [
    'name',
    'logoUrl',
    'tagline',
    'registrationNumber',
    'gstin',
    'address.line1',
    'address.line2',
    'address.city',
    'address.state',
    'address.postalCode',
    'address.country',
    'phone',
    'email',
    'website',
    'timezone',
    'currency',
    'workingDays',
  ],
  appointments: [
    'appointment.defaultSlotMinutes',
    'appointment.bookingWindowDays',
    'appointment.minCancelHours',
    'appointment.allowPatientSelfBooking',
    'appointment.maxActiveBookingsPerPatient',
    'appointment.walkInOverbookPerSession',
    'appointment.noShowGraceMinutes',
    'appointment.reminderHoursBefore',
  ],
  billing: [
    'billing.invoicePrefix',
    'billing.defaultTaxRatePercent',
    'billing.taxLabel',
    'billing.maxDiscountPercentWithoutAdmin',
    'billing.paymentMethods',
    'billing.invoiceFooter',
  ],
  lab: ['lab.requireDualVerification', 'lab.criticalAlertEnabled'],
  ai: [
    'ai.enabled',
    'ai.clinicalSummaryEnabled',
    'ai.patientExplanationEnabled',
    'ai.explanationLanguages',
  ],
  notifications: ['notifications.emailEnabled'],
} as const;

export type SettingsTab = keyof typeof TAB_FIELDS;
export const ALL_FIELDS = Object.values(TAB_FIELDS).flat();
