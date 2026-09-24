import { useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { env } from '../../utils/env';

/**
 * The kiosk's own Socket.IO connection, authenticated with the kiosk key (no user login). Calls
 * `onUpdate` on every `queue.updated`. @returns whether it is connected (the board polls while it
 * is not).
 */
export function useKioskSocket(key: string, onUpdate: () => void): boolean {
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    if (!env.realtime || !key) return;
    let socket: Socket | undefined;
    let cancelled = false;
    void import('socket.io-client').then(({ io }) => {
      if (cancelled) return;
      socket = io(env.socketUrl, { auth: { kioskKey: key }, transports: ['websocket'] });
      socket.on('connect', () => setConnected(true));
      socket.on('disconnect', () => setConnected(false));
      socket.on('connect_error', () => setConnected(false));
      socket.on('queue.updated', onUpdate);
    });
    return () => {
      cancelled = true;
      socket?.disconnect();
    };
    // onUpdate is stable (a dispatch); reconnect only for another key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return connected;
}
