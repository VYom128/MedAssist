import type { Role } from '../config/constants.js';

/** The authenticated caller, set by the authenticate middleware. */
export interface AuthUser {
  id: string;
  role: Role;
  /** Session id from the access token's `sid` claim (may be an already-rotated session). */
  sid: string;
  /** Rotation family of that session: one login on one device. */
  sessionFamily: string;
  firstName: string;
  lastName: string;
  /** Linked Patient record (role=patient only; set from Phase 3). */
  patientId: string | null;
}

declare global {
  namespace Express {
    interface Request {
      /** Set by requestId middleware; echoed as X-Request-Id and included in error responses. */
      id: string;
      /** Set by authenticate; undefined on public routes. */
      user?: AuthUser;
    }
  }
}

export {};
