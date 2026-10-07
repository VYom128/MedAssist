import type { Dispatch } from '@reduxjs/toolkit';
import type { Socket } from 'socket.io-client';
import { apiSlice } from './apiSlice';

/** A follow-up request changed (Phase 8): ids only. */
export interface FollowupUpdated {
  requestId: string;
}

/** What the server sends (ids only, spec §7.9). */
export interface QueueUpdated {
  doctorId: string;
  date: string;
}
export interface AppointmentChanged {
  appointmentId: string;
}

/** Lab events (Phase 6): ids only. */
export interface LabWorklistUpdated {
  orderIds: string[];
}
export interface LabOrderChanged {
  orderId: string;
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

/** Cache tags to refresh when lab orders changed. */
export const labTags = (orderIds: readonly string[]) => [
  { type: 'LabWorklist' as const, id: 'LIST' },
  ...orderIds.map((id) => ({ type: 'LabOrder' as const, id })),
];

/**
 * Maps socket events to RTK Query invalidation: `queue.updated` → that doctor's queue, the
 * calendars showing that date, appointment lists, free slots; `appointment.changed` → that
 * appointment; `lab.worklist.updated` → the lab lists and those orders; `lab.order.changed` and
 * `lab.critical` → that order and the lists (the doctor's critical alert reads them);
 * `followup.updated` → that request, the follow-up lists and timelines. Returns a function that
 * removes the listeners.
 */
export function attachInvalidation(source: EventSource, dispatch: Dispatch): () => void {
  const onQueue = (payload: QueueUpdated) =>
    dispatch(apiSlice.util.invalidateTags(queueUpdatedTags(payload)));
  // Timelines show appointments and lab orders (Phase 8): refetch them too.
  const onAppointment = ({ appointmentId }: AppointmentChanged) =>
    dispatch(
      apiSlice.util.invalidateTags([{ type: 'Appointment', id: appointmentId }, 'Timeline']),
    );
  const onWorklist = ({ orderIds }: LabWorklistUpdated) =>
    dispatch(apiSlice.util.invalidateTags(labTags(orderIds ?? [])));
  const onLabOrder = ({ orderId }: LabOrderChanged) =>
    dispatch(apiSlice.util.invalidateTags([...labTags([orderId]), 'Timeline']));
  const onFollowup = ({ requestId }: FollowupUpdated) =>
    dispatch(
      apiSlice.util.invalidateTags([
        { type: 'FollowUp', id: requestId },
        { type: 'FollowUpList', id: 'LIST' },
        'Timeline',
      ]),
    );
  source.on('queue.updated', onQueue);
  source.on('followup.updated', onFollowup);
  source.on('appointment.changed', onAppointment);
  source.on('lab.worklist.updated', onWorklist);
  source.on('lab.order.changed', onLabOrder);
  source.on('lab.critical', onLabOrder);
  return () => {
    source.off('queue.updated', onQueue);
    source.off('followup.updated', onFollowup);
    source.off('appointment.changed', onAppointment);
    source.off('lab.worklist.updated', onWorklist);
    source.off('lab.order.changed', onLabOrder);
    source.off('lab.critical', onLabOrder);
  };
}
