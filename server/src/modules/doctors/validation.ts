import { z } from 'zod';
import {
  booleanQuery,
  email,
  idParams,
  namePart,
  objectId,
  optionalText,
  paginationQuery,
  paise,
  phone,
} from '../../utils/zod.js';

const shortList = (label: string, maxItems: number, maxLength: number) =>
  z
    .array(z.string().trim().min(1, 'Required').max(maxLength, `At most ${maxLength} characters`))
    .max(maxItems, `At most ${maxItems} ${label}`)
    .transform((items) => [...new Set(items)]);

/** Doctor profile fields (spec §6.8). */
const profileFields = {
  department: objectId,
  specialization: z.string().trim().min(2, 'At least 2 characters').max(100),
  qualifications: shortList('qualifications', 10, 60),
  registrationNumber: z.string().trim().min(3, 'At least 3 characters').max(50),
  experienceYears: z.number().int('Whole years').min(0).max(70).nullable(),
  consultationFeePaise: paise.nullable(),
  slotMinutes: z.number().int('Whole minutes').min(5).max(120).nullable(),
  roomNumber: optionalText(20),
  bio: optionalText(1000),
  languages: shortList('languages', 10, 30),
  isAcceptingAppointments: z.boolean(),
};

export const listDoctorsSchema = {
  query: z.object({
    ...paginationQuery,
    department: objectId.optional(),
    specialization: z.string().trim().min(1).max(100).optional(),
    q: z.string().trim().min(1).max(100).optional(),
    accepting: booleanQuery,
    /** Admins only; ignored for everyone else. */
    includeInactive: booleanQuery,
  }),
};

/** POST /doctors – the User account and the profile together. */
export const createDoctorSchema = {
  body: z.strictObject({
    firstName: namePart,
    lastName: namePart,
    email,
    phone: phone.optional(),
    department: profileFields.department,
    specialization: profileFields.specialization,
    qualifications: profileFields.qualifications.optional(),
    registrationNumber: profileFields.registrationNumber,
    experienceYears: profileFields.experienceYears.optional(),
    consultationFeePaise: profileFields.consultationFeePaise.optional(),
    slotMinutes: profileFields.slotMinutes.optional(),
    roomNumber: profileFields.roomNumber,
    bio: profileFields.bio,
    languages: profileFields.languages.optional(),
    isAcceptingAppointments: profileFields.isAcceptingAppointments.optional(),
  }),
};

/**
 * PATCH /doctors/:id – profile fields only (name, email and phone are account fields: PATCH
 * /users/:id). Doctors may send only DOCTOR_SELF_EDITABLE_FIELDS (checked in the service).
 */
export const updateDoctorSchema = {
  params: idParams,
  body: z
    .strictObject({
      department: profileFields.department.optional(),
      specialization: profileFields.specialization.optional(),
      qualifications: profileFields.qualifications.optional(),
      registrationNumber: profileFields.registrationNumber.optional(),
      experienceYears: profileFields.experienceYears.optional(),
      consultationFeePaise: profileFields.consultationFeePaise.optional(),
      slotMinutes: profileFields.slotMinutes.optional(),
      roomNumber: profileFields.roomNumber,
      bio: profileFields.bio,
      languages: profileFields.languages.optional(),
      isAcceptingAppointments: profileFields.isAcceptingAppointments.optional(),
    })
    .refine((b) => Object.keys(b).length > 0, 'Nothing to update'),
};

export const doctorIdSchema = { params: idParams };

export type ListDoctorsQuery = z.infer<typeof listDoctorsSchema.query>;
export type CreateDoctorInput = z.infer<typeof createDoctorSchema.body>;
export type UpdateDoctorInput = z.infer<typeof updateDoctorSchema.body>;
