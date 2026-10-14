import { getDBState, type DBState } from '../../config/db.js';
import { config } from '../../config/env.js';

export interface HealthStatus {
  status: 'ok';
  uptime: number;
  timestamp: string;
  db: DBState;
  /** The deployed commit (Render's RENDER_GIT_COMMIT), or null. */
  commit: string | null;
}

/** API liveness, the current MongoDB connection state and the deployed commit. */
export function getHealth(): HealthStatus {
  return {
    status: 'ok',
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    db: getDBState(),
    commit: config.build.commit,
  };
}
