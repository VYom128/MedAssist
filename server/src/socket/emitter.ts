import type { Server } from 'socket.io';
import { ROLES, SOCKET_EVENTS, SOCKET_ROOMS } from '../config/constants.js';

/**
 * Real-time events (spec §7.9). Payloads carry ids only – never patient data; clients refetch
 * through the API, which applies the access rules. Call the emitters after the transaction has
 * committed. Without an attached Socket.IO server (HTTP-only tests, the seed) they do nothing.
 */

let io: Server | null = null;

/** Called by socket/index.ts when the server starts (null on shutdown). */
export function setSocketServer(server: Server | null): void {
  io = server;
}

/** A doctor's queue for a clinic date changed: staff and that doctor's screens, and the board. */
export function emitQueueUpdated(doctorId: string, date: string): void {
  if (!io) return;
  const payload = { doctorId, date };
  io.to([SOCKET_ROOMS.queue(doctorId, date), SOCKET_ROOMS.board]).emit(
    SOCKET_EVENTS.QUEUE_UPDATED,
    payload,
  );
}

/** An appointment changed: tells the given users (patient account, doctor) to refetch it. */
export function emitAppointmentChanged(appointmentId: string, userIds: readonly string[]): void {
  if (!io || userIds.length === 0) return;
  io.to(userIds.map(SOCKET_ROOMS.user)).emit(SOCKET_EVENTS.APPOINTMENT_CHANGED, { appointmentId });
}

/** Lab orders were placed or changed: every lab technician's worklist refetches. */
export function emitLabWorklistUpdated(orderIds: readonly string[]): void {
  if (!io || orderIds.length === 0) return;
  io.to(SOCKET_ROOMS.lab).emit(SOCKET_EVENTS.LAB_WORKLIST_UPDATED, { orderIds: [...orderIds] });
}

/** A lab order changed: tells the given users (ordering doctor, patient account) to refetch it. */
export function emitLabOrderChanged(orderId: string, userIds: readonly string[]): void {
  if (!io || userIds.length === 0) return;
  io.to(userIds.map(SOCKET_ROOMS.user)).emit(SOCKET_EVENTS.LAB_ORDER_CHANGED, { orderId });
}

/**
 * A follow-up request was created or changed (Phase 8): the given users (assigned doctor(s),
 * the patient's account) and every receptionist refetch it. Ids only – never message text.
 */
export function emitFollowupUpdated(requestId: string, userIds: readonly string[]): void {
  if (!io) return;
  io.to([...userIds.map(SOCKET_ROOMS.user), SOCKET_ROOMS.role(ROLES.RECEPTIONIST)]).emit(
    SOCKET_EVENTS.FOLLOWUP_UPDATED,
    { requestId },
  );
}

/** A critical value was entered: the ordering doctor's alert (ids only, spec §8.7). */
export function emitLabCritical(orderId: string, doctorId: string): void {
  if (!io) return;
  io.to(SOCKET_ROOMS.user(doctorId)).emit(SOCKET_EVENTS.LAB_CRITICAL, { orderId });
}
