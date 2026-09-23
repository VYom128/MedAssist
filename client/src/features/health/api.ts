import { AxiosError } from 'axios';
import { http, type ApiSuccess } from '../../utils/http';

export interface HealthStatus {
  api: 'ok';
  db: 'connected' | 'disconnected';
  uptime: number;
  timestamp: string;
}

/** The API answers 503 with the same body when the DB is down, so treat that as a valid status. */
export async function fetchHealth(signal?: AbortSignal): Promise<HealthStatus> {
  try {
    const res = await http.get<ApiSuccess<HealthStatus>>('/health', { signal });
    return res.data.data;
  } catch (err) {
    const body = err instanceof AxiosError ? err.response?.data : undefined;
    if (err instanceof AxiosError && err.response?.status === 503 && body?.data) {
      return (body as ApiSuccess<HealthStatus>).data;
    }
    throw err;
  }
}
