import { useEffect } from 'react';
import { refreshSession } from '../app/axiosBaseQuery';
import { useAppDispatch, useAppSelector } from '../app/hooks';
import { connectSocket, disconnectSocket, followQueue } from '../app/socket';
import { attachInvalidation } from '../app/socketInvalidation';
import { env } from '../utils/env';

/**
 * Keeps the Socket.IO connection in step with the session (mounted once, in AppLayout): connects
 * after login, reconnects with the new access token after a refresh, disconnects on logout, and
 * turns server events into RTK Query invalidations. A handshake refused because the token
 * expired triggers a refresh (which reconnects).
 */
export function useSocketInvalidation() {
  const accessToken = useAppSelector((s) => s.auth.accessToken);
  const dispatch = useAppDispatch();

  useEffect(() => {
    if (!env.realtime) return;
    if (!accessToken) {
      disconnectSocket();
      return;
    }
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    void connectSocket(accessToken).then((socket) => {
      if (cancelled) return;
      const detach = attachInvalidation(socket, dispatch);
      const onError = (err: Error & { data?: { code?: string } }) => {
        if (err.data?.code === 'TOKEN_EXPIRED') void refreshSession(dispatch);
      };
      socket.on('connect_error', onError);
      cleanup = () => {
        detach();
        socket.off('connect_error', onError);
      };
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [accessToken, dispatch]);

  // Leaving the logged-in shell (logout) closes the connection.
  useEffect(() => () => disconnectSocket(), []);
}

/** Follow the queue rooms of these doctors on these dates while the component is mounted. */
export function useQueueRooms(rooms: readonly { doctorId: string; date: string }[]) {
  const key = rooms.map((r) => `${r.doctorId}|${r.date}`).join(',');
  useEffect(() => {
    if (!env.realtime || !key) return;
    const stops = key.split(',').map((k) => {
      const [doctorId, date] = k.split('|') as [string, string];
      return followQueue(doctorId, date);
    });
    return () => stops.forEach((stop) => stop());
  }, [key]);
}
