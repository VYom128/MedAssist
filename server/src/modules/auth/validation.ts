import { z } from 'zod';
import {
  PERSONAL_INFO_MESSAGE,
  checkPasswordStrength,
  passwordSchema,
} from '../../utils/password.js';
import { dateOfBirth, email, idParams, namePart, phone } from '../../utils/zod.js';

/**
 * POST /auth/register – patient self-signup (§4.4). Phone + DOB are matched against existing
 * patient records; consent to data processing is required (§10.6).
 */
export const registerSchema = {
  body: z
    .object({
      firstName: namePart,
      lastName: namePart,
      email,
      phone,
      dateOfBirth,
      password: passwordSchema,
      acceptTerms: z.literal(true, 'You must accept the terms to create an account'),
      consent: z.strictObject(
        {
          dataProcessing: z.literal(true, 'Consent to data processing is required'),
          aiExplanations: z.boolean().optional(),
          communications: z
            .strictObject({ email: z.boolean().optional(), sms: z.boolean().optional() })
            .optional(),
        },
        'Consent to data processing is required',
      ),
    })
    .superRefine((b, ctx) => {
      const problems = checkPasswordStrength(b.password, b);
      if (problems.includes(PERSONAL_INFO_MESSAGE)) {
        ctx.addIssue({ code: 'custom', path: ['password'], message: PERSONAL_INFO_MESSAGE });
      }
    }),
};

/** POST /auth/login. Only presence is checked so the error never hints at the policy. */
export const loginSchema = {
  body: z.object({
    email,
    password: z.string().min(1, 'Required').max(200),
  }),
};

/** PATCH /auth/me – name and phone (avatar arrives with uploads in Phase 6). */
export const updateMeSchema = {
  body: z
    .strictObject({
      firstName: namePart.optional(),
      lastName: namePart.optional(),
      phone: phone.optional(),
    })
    .refine((b) => Object.keys(b).length > 0, 'Nothing to update'),
};

export const changePasswordSchema = {
  body: z
    .object({
      currentPassword: z.string().min(1, 'Required').max(200),
      newPassword: passwordSchema,
    })
    .refine((b) => b.currentPassword !== b.newPassword, {
      message: 'New password must be different from the current one',
      path: ['newPassword'],
    }),
};

export const forgotPasswordSchema = { body: z.object({ email }) };

export const resetPasswordSchema = {
  body: z.object({
    token: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_-]{20,200}$/, 'Invalid reset link'),
    newPassword: passwordSchema,
  }),
};

export const sessionIdSchema = { params: idParams };

export type RegisterInput = z.infer<typeof registerSchema.body>;
export type UpdateMeInput = z.infer<typeof updateMeSchema.body>;
