import { getDBState, type DBState } from '../../config/db.js';

export interface HealthStatus {
  status: 'ok';
  uptime: number;
  timestamp: string;
  db: DBState;
}

/** API liveness plus the current MongoDB connection state. */
export function getHealth(): HealthStatus {
  return {
    status: 'ok',
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    db: getDBState(),
  };
}
