import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { z } from 'zod';
import {
  OPEN_APPOINTMENT_STATUSES,
  ROLES,
  SOCKET_EVENTS,
  SOCKET_ROOMS,
} from '../config/constants.js';
import { config } from '../config/env.js';
import { resolveAccessToken } from '../middlewares/authenticate.js';
import { Appointment } from '../modules/appointments/model.js';
import { getSettings } from '../modules/settings/service.js';
import type { AuthUser } from '../types/express.js';
import { ApiError } from '../utils/ApiError.js';
import { addDaysToDate, startOfClinicDay } from '../utils/dates.js';
import { isKioskKey } from '../utils/kioskKey.js';
import { logger, serializeError } from '../utils/logger.js';
import { dateOnly, objectId } from '../utils/zod.js';
import { setSocketServer } from './emitter.js';

/**
 * Socket.IO (spec §7.9). Clients authenticate in the handshake:
 * - `auth: { token }` – an access token, with the same checks as `authenticate` (live session,
 *   active user, no pending password change). The socket joins `user:<userId>`, and may join
 *   `queue:<doctorId>:<date>` rooms with `queue:subscribe` (staff any doctor, a doctor their own,
 *   a patient the doctor they have an appointment with that day);
 * - `auth: { kioskKey }` – the queue board; joins `board` only.
 * Events carry ids only (socket/emitter.ts); clients refetch through the API.
 */

interface SocketData {
  user?: AuthUser;
  token?: string;
  kiosk?: boolean;
}
type AppSocket = Socket<
  Record<string, never>,
  Record<string, never>,
  Record<string, never>,
  SocketData
>;
type Ack = (result: { ok: true } | { ok: false; error: { code: string; message: string } }) => void;

/** The Error passed to `connect_error` on the client: `message` + `data.code`. */
function handshakeError(err: unknown): Error & { data: { code: string } } {
  const api = err instanceof ApiError ? err : ApiError.unauthorized();
  return Object.assign(new Error(api.message), { data: { code: api.code } });
}

const subscribeSchema = z.object({ doctorId: objectId, date: dateOnly });

/** May `user` follow this doctor's queue on `date`? */
async function canFollowQueue(user: AuthUser, doctorId: string, date: string): Promise<boolean> {
  switch (user.role) {
    case ROLES.ADMIN:
    case ROLES.RECEPTIONIST:
      return true;
    case ROLES.DOCTOR:
      return user.id === doctorId;
    case ROLES.PATIENT: {
      if (!user.patientId) return false;
      const { timezone } = await getSettings();
      return Boolean(
        await Appointment.exists({
          patient: user.patientId,
          doctor: doctorId,
          status: { $in: OPEN_APPOINTMENT_STATUSES },
          startAt: {
            $gte: startOfClinicDay(date, timezone),
            $lt: startOfClinicDay(addDaysToDate(date, 1), timezone),
          },
        }),
      );
    }
    default:
      return false;
  }
}

function onQueueSubscribe(socket: AppSocket) {
  return async (payload: unknown, ack?: Ack) => {
    const reply: Ack = typeof ack === 'function' ? ack : () => undefined;
    try {
      const parsed = subscribeSchema.safeParse(payload);
      if (!parsed.success) throw ApiError.badRequest('Send { doctorId, date }');
      // Re-checked on every subscribe: a revoked session or an expired token stops here.
      const user = await resolveAccessToken(socket.data.token);
      const { doctorId, date } = parsed.data;
      if (!(await canFollowQueue(user, doctorId, date))) {
        throw ApiError.forbidden('You cannot follow this queue');
      }
      await socket.join(SOCKET_ROOMS.queue(doctorId, date));
      reply({ ok: true });
    } catch (err) {
      const api = err instanceof ApiError ? err : ApiError.internal();
      if (!(err instanceof ApiError)) {
        logger.error({ err: serializeError(err) }, 'Socket queue subscribe failed');
      }
      reply({ ok: false, error: { code: api.code, message: api.message } });
    }
  };
}

/** Attaches Socket.IO to the HTTP server and makes the emitters live. */
export function initSocket(httpServer: HttpServer): Server {
  const io = new Server<
    Record<string, never>,
    Record<string, never>,
    Record<string, never>,
    SocketData
  >(httpServer, {
    cors: { origin: config.clientUrl, credentials: true },
    serveClient: false,
  });

  io.use((socket, next) => {
    const auth = (socket.handshake.auth ?? {}) as { token?: unknown; kioskKey?: unknown };
    if (auth.kioskKey !== undefined) {
      if (isKioskKey(auth.kioskKey)) {
        socket.data.kiosk = true;
        next();
      } else {
        next(handshakeError(ApiError.unauthorized('Invalid kiosk key')));
      }
      return;
    }
    const token = typeof auth.token === 'string' ? auth.token : undefined;
    resolveAccessToken(token)
      .then((user) => {
        socket.data.user = user;
        socket.data.token = token;
        next();
      })
      .catch((err: unknown) => {
        if (!(err instanceof ApiError)) {
          logger.error({ err: serializeError(err) }, 'Socket handshake failed');
        }
        next(handshakeError(err));
      });
  });

  io.on('connection', (socket) => {
    if (socket.data.kiosk) {
      void socket.join(SOCKET_ROOMS.board);
      return;
    }
    const user = socket.data.user!;
    void socket.join(SOCKET_ROOMS.user(user.id));
    socket.on(SOCKET_EVENTS.QUEUE_SUBSCRIBE, onQueueSubscribe(socket));
    socket.on(SOCKET_EVENTS.QUEUE_UNSUBSCRIBE, (payload: unknown, ack?: Ack) => {
      const parsed = subscribeSchema.safeParse(payload);
      if (parsed.success) {
        void socket.leave(SOCKET_ROOMS.queue(parsed.data.doctorId, parsed.data.date));
      }
      if (typeof ack === 'function') ack({ ok: true });
    });
  });

  setSocketServer(io as unknown as Server);
  return io as unknown as Server;
}

/**
 * Disconnects every client and stops the emitters, leaving the HTTP server open so the caller
 * can close it (graceful shutdown).
 */
export function closeSocket(io: Server): void {
  setSocketServer(null);
  io.disconnectSockets(true);
  io.engine.close();
}
