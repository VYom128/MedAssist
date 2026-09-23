import { z } from 'zod';
import { ROLE_VALUES, ROLES, USER_CREATABLE_ROLES } from '../../config/constants.js';
import { email, idParams, namePart, phone, sortQuery } from '../../utils/zod.js';

/** Fields GET /users can sort by. */
export const USER_SORT_FIELDS = [
  'createdAt',
  'firstName',
  'lastName',
  'email',
  'role',
  'lastLoginAt',
] as const;

export const listUsersSchema = {
  query: z.object({
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
    role: z.enum(ROLE_VALUES as [string, ...string[]]).optional(),
    isActive: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional(),
    q: z.string().trim().min(1).max(100).optional(),
    sort: sortQuery(USER_SORT_FIELDS, { createdAt: -1 }),
  }),
};

/** Message for POST /users with role "doctor". */
export const DOCTOR_VIA_DOCTORS_MESSAGE =
  'Create doctor accounts with POST /doctors (it also creates the doctor profile)';

/**
 * POST /users – staff accounts (admin, receptionist, labtech). Doctors go through POST /doctors;
 * patients sign up or are invited.
 */
export const createUserSchema = {
  body: z.object({
    firstName: namePart,
    lastName: namePart,
    email,
    phone: phone.optional(),
    role: z.enum(USER_CREATABLE_ROLES, {
      error: (issue) =>
        issue.input === ROLES.DOCTOR
          ? DOCTOR_VIA_DOCTORS_MESSAGE
          : `Role must be one of: ${USER_CREATABLE_ROLES.join(', ')}`,
    }),
  }),
};

/** PATCH /users/:id – name, phone, email. Unknown keys (e.g. role) are rejected, not ignored. */
export const updateUserSchema = {
  params: idParams,
  body: z
    .strictObject({
      firstName: namePart.optional(),
      lastName: namePart.optional(),
      email: email.optional(),
      phone: phone.optional(),
    })
    .refine((b) => Object.keys(b).length > 0, 'Nothing to update'),
};

export const userIdSchema = { params: idParams };

export type ListUsersQuery = z.infer<typeof listUsersSchema.query>;
export type CreateUserInput = z.infer<typeof createUserSchema.body>;
export type UpdateUserInput = z.infer<typeof updateUserSchema.body>;
