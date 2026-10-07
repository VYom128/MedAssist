import { z } from 'zod';
import { clinicDate } from '../../utils/dates';
import { FOLLOWUP_TYPES } from './api';

/** The patient's new follow-up request (server: POST /follow-up-requests). */
export const newFollowupSchema = z.object({
  type: z.enum(FOLLOWUP_TYPES, { error: 'Choose what this is about' }),
  relatedAppointmentId: z.string(),
  message: z.string().trim().min(1, 'Tell us what you need').max(2000, 'At most 2000 characters'),
  preferredDate: z.string().refine((d) => !d || d >= clinicDate(), 'Choose today or a later date'),
});
export type NewFollowupValues = z.infer<typeof newFollowupSchema>;
