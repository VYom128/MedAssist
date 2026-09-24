import type { Server } from 'socket.io';
import { SOCKET_EVENTS, SOCKET_ROOMS } from '../config/constants.js';

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
