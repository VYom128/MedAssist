import { z } from 'zod';
import { ADMIN_CREATABLE_ROLES, ROLE_VALUES } from '../../config/constants.js';
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

/** POST /users – staff accounts (admin, doctor, receptionist, labtech). Never patients. */
export const createUserSchema = {
  body: z.object({
    firstName: namePart,
    lastName: namePart,
    email,
    phone: phone.optional(),
    role: z.enum(ADMIN_CREATABLE_ROLES),
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
