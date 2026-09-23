import { z } from 'zod';

// Mirrors server/src/modules/auth/validation.ts. The server also rejects the 1,000 most common
// passwords; that error comes back as a field error on submit.

const email = z.string().trim().min(1, 'Enter your email').pipe(z.email('Enter a valid email'));
const namePart = z.string().trim().min(1, 'Required').max(50, 'At most 50 characters');
const phone = z
  .string()
  .trim()
  .regex(/^\+?[\d\s-]{10,20}$/, 'Enter a valid phone number');

export const passwordRules = z
  .string()
  .min(8, 'Must be at least 8 characters')
  .max(72, 'Must be at most 72 characters')
  .refine((p) => /\p{L}/u.test(p) && /\d/.test(p), 'Must contain a letter and a number');

/**
 * The password rules as a checklist for live hints (mirrors server checkPasswordStrength, except
 * the common-password list, which only the server has).
 */
export function passwordChecks(
  password: string,
  personal: { email?: string; firstName?: string } = {},
): { label: string; ok: boolean }[] {
  const lower = password.toLowerCase();
  const parts = [personal.email?.split('@')[0], personal.firstName]
    .map((p) => p?.trim().toLowerCase())
    .filter((p): p is string => Boolean(p && p.length >= 3));
  return [
    { label: 'At least 8 characters', ok: password.length >= 8 && password.length <= 72 },
    { label: 'A letter and a number', ok: /\p{L}/u.test(password) && /\d/.test(password) },
    {
      label: 'Does not contain your name or email',
      ok: password.length > 0 && !parts.some((p) => lower.includes(p)),
    },
  ];
}

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Enter your password'),
});

const dateOfBirth = z
  .string()
  .min(1, 'Enter your date of birth')
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Enter a valid date')
  .refine((v) => new Date(v).getTime() <= Date.now(), 'Date of birth cannot be in the future');

export const registerSchema = z
  .object({
    firstName: namePart,
    lastName: namePart,
    email,
    phone,
    /** YYYY-MM-DD (from <input type="date">). */
    dateOfBirth,
    password: passwordRules,
    confirmPassword: z.string(),
    acceptTerms: z.boolean().refine((v) => v, 'You must accept the terms to create an account'),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z
  .object({ password: passwordRules, confirmPassword: z.string() })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: passwordRules,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    message: 'New password must be different from the current one',
    path: ['newPassword'],
  });

export const profileSchema = z.object({ firstName: namePart, lastName: namePart, phone });

export type LoginValues = z.infer<typeof loginSchema>;
export type RegisterValues = z.infer<typeof registerSchema>;
export type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;
export type ChangePasswordValues = z.infer<typeof changePasswordSchema>;
export type ProfileValues = z.infer<typeof profileSchema>;
