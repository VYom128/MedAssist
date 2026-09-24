import type { Dispatch } from '@reduxjs/toolkit';
import type { Socket } from 'socket.io-client';
import { apiSlice } from './apiSlice';

/** What the server sends (ids only, spec §7.9). */
export interface QueueUpdated {
  doctorId: string;
  date: string;
}
export interface AppointmentChanged {
  appointmentId: string;
}

/** The socket (or a stand-in in tests). */
type EventSource = Pick<Socket, 'on' | 'off'>;

/** Cache tags to refresh when a doctor's day changed. */
export const queueUpdatedTags = ({ doctorId, date }: QueueUpdated) => [
  { type: 'Queue' as const, id: `${doctorId}:${date}` },
  { type: 'Queue' as const, id: 'me' },
  { type: 'Calendar' as const, id: date },
  { type: 'AppointmentList' as const, id: 'LIST' },
  { type: 'Slots' as const, id: `${doctorId}:${date}` },
  { type: 'Availability' as const, id: doctorId },
  'QueueBoard' as const,
];

/**
 * Maps socket events to RTK Query invalidation: `queue.updated` → that doctor's queue, the
 * calendars showing that date, appointment lists, free slots; `appointment.changed` → that
 * appointment. Returns a function that removes the listeners.
 */
export function attachInvalidation(source: EventSource, dispatch: Dispatch): () => void {
  const onQueue = (payload: QueueUpdated) =>
    dispatch(apiSlice.util.invalidateTags(queueUpdatedTags(payload)));
  const onAppointment = ({ appointmentId }: AppointmentChanged) =>
    dispatch(apiSlice.util.invalidateTags([{ type: 'Appointment', id: appointmentId }]));
  source.on('queue.updated', onQueue);
  source.on('appointment.changed', onAppointment);
  return () => {
    source.off('queue.updated', onQueue);
    source.off('appointment.changed', onAppointment);
  };
}
