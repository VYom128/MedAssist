import type { Request } from 'express';
import type { AuthUser } from '../types/express.js';

export interface RequestMeta {
  id: string;
  method: string;
  path: string;
  ip?: string;
  userAgent?: string;
}

export interface AuditActor {
  user: string | null;
  role: string | null;
  name: string | null;
}

const MAX_USER_AGENT = 256;

/**
 * Where a request came from, for audit entries (spec §10.4). The path is `originalUrl` without
 * the query string: queries can hold search terms such as patient names.
 */
export function buildRequestMeta(req: Request): RequestMeta {
  const userAgent = req.get('user-agent')?.slice(0, MAX_USER_AGENT);
  return {
    id: String(req.id),
    method: req.method,
    path: req.originalUrl.split('?')[0] ?? '',
    ...(req.ip ? { ip: req.ip } : {}),
    ...(userAgent ? { userAgent } : {}),
  };
}

/** The logged-in user as an audit actor, or null fields when nobody is logged in. */
export function actorFromRequest(req: Request): AuditActor {
  const u = req.user;
  if (!u) return { user: null, role: null, name: null };
  return { user: u.id, role: u.role, name: `${u.firstName} ${u.lastName}` };
}

/** A logged-in user (as passed to services) as an audit actor. */
export function actorOf(u: AuthUser): AuditActor {
  return { user: u.id, role: u.role, name: `${u.firstName} ${u.lastName}` };
}
