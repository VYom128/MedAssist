import { z } from 'zod';
import { STAFF_ROLES } from '../../constants/roles';

// Mirrors server/src/modules/users/validation.ts.
const namePart = z.string().trim().min(1, 'Required').max(50, 'At most 50 characters');
const email = z.string().trim().min(1, 'Enter an email').pipe(z.email('Enter a valid email'));
const optionalPhone = z
  .string()
  .trim()
  .refine((v) => v === '' || /^\+?[\d\s-]{10,20}$/.test(v), 'Enter a valid phone number');

export const staffSchema = z.object({
  firstName: namePart,
  lastName: namePart,
  email,
  phone: optionalPhone,
  role: z.enum(STAFF_ROLES, 'Choose a role'),
});

export const userEditSchema = z.object({
  firstName: namePart,
  lastName: namePart,
  email,
  phone: optionalPhone,
});

export type StaffFormValues = z.infer<typeof staffSchema>;
export type UserEditValues = z.infer<typeof userEditSchema>;

/** Drops an empty phone (the server treats "not given" differently from invalid). */
export function withoutEmptyPhone<T extends { phone: string }>(values: T) {
  const { phone, ...rest } = values;
  return phone ? { ...rest, phone } : rest;
}
