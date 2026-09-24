import type { Socket } from 'socket.io-client';
import { env } from '../utils/env';

/**
 * The one Socket.IO connection (spec §7.9), opened after login with the in-memory access token.
 * Events carry ids only; screens refetch through RTK Query (see useSocketInvalidation). Queue
 * rooms joined with `followQueue` are re-joined after every reconnect (the server forgets them).
 */

let socket: Socket | null = null;
let token: string | null = null;
/** Queue rooms wanted by mounted screens: key 'doctorId|date' → number of subscribers. */
const rooms = new Map<string, number>();

const joinAll = () => {
  for (const key of rooms.keys()) {
    const [doctorId, date] = key.split('|');
    socket?.emit('queue:subscribe', { doctorId, date });
  }
};

/**
 * Connects (or reconnects with a new token after a refresh). socket.io-client is loaded on first
 * use, so it stays out of the main bundle.
 */
export async function connectSocket(accessToken: string): Promise<Socket> {
  if (socket) {
    if (accessToken !== token) {
      token = accessToken;
      socket.auth = { token: accessToken };
      socket.disconnect().connect();
    }
    return socket;
  }
  const { io } = await import('socket.io-client');
  if (socket) return connectSocket(accessToken); // another caller connected meanwhile
  token = accessToken;
  socket = io(env.socketUrl, { auth: { token: accessToken }, transports: ['websocket'] });
  socket.on('connect', joinAll);
  return socket;
}

/** Closes the connection (logout). */
export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
  token = null;
  rooms.clear();
}

export const getSocket = () => socket;

/**
 * Follow a doctor's queue for a clinic date (staff any doctor, a doctor their own, a patient the
 * doctor they see that day – the server checks). Returns the function that stops following.
 */
export function followQueue(doctorId: string, date: string): () => void {
  const key = `${doctorId}|${date}`;
  rooms.set(key, (rooms.get(key) ?? 0) + 1);
  if (rooms.get(key) === 1 && socket?.connected) {
    socket.emit('queue:subscribe', { doctorId, date });
  }
  return () => {
    const left = (rooms.get(key) ?? 1) - 1;
    if (left > 0) {
      rooms.set(key, left);
      return;
    }
    rooms.delete(key);
    if (socket?.connected) socket.emit('queue:unsubscribe', { doctorId, date });
  };
}
