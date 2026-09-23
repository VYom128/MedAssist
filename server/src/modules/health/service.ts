import { isDBConnected } from '../../config/db.js';

export interface HealthStatus {
  api: 'ok';
  db: 'connected' | 'disconnected';
  uptime: number;
  timestamp: string;
}

export function getHealth(): HealthStatus {
  return {
    api: 'ok',
    db: isDBConnected() ? 'connected' : 'disconnected',
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  };
}
