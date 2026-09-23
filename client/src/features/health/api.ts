import { http, type ApiSuccess } from '../../utils/http';

export interface HealthStatus {
  status: 'ok';
  uptime: number;
  timestamp: string;
  db: 'connected' | 'disconnected' | 'connecting' | 'disconnecting';
}

export async function fetchHealth(signal?: AbortSignal): Promise<HealthStatus> {
  const res = await http.get<ApiSuccess<HealthStatus>>('/health', { signal });
  return res.data.data;
}
