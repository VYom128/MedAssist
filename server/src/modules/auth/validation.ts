import { z } from 'zod';
import { passwordSchema } from '../../utils/passwordPolicy.js';
import { email, idParams, namePart, phone } from '../../utils/zod.js';

/** POST /auth/register – patient self-signup. DOB and patient matching come in Phase 3. */
export const registerSchema = {
  body: z.object({
    firstName: namePart,
    lastName: namePart,
    email,
    phone,
    password: passwordSchema,
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
    password: passwordSchema,
  }),
};

export const sessionIdSchema = { params: idParams };

export type RegisterInput = z.infer<typeof registerSchema.body>;
export type UpdateMeInput = z.infer<typeof updateMeSchema.body>;
