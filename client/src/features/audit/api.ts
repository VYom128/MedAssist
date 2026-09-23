import { apiSlice } from '../../app/apiSlice';
import type { PageMeta } from '../../components/ui/Pagination';
import type { ApiSuccess } from '../../utils/http';

/** `toAuditView` on the server. */
export interface AuditEntry {
  id: string;
  seq: number;
  at: string;
  actor: { user: string | null; role: string | null; name: string | null };
  action: string;
  resource: { type: string; id: string | null; number: string | null } | null;
  patient: string | null;
  outcome: 'success' | 'denied' | 'failure';
  request: { id?: string; method?: string; path?: string; ip?: string; userAgent?: string } | null;
  changes: {
    fields: string[];
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
  } | null;
  metadata: Record<string, unknown> | null;
}

export interface AuditListParams {
  page?: number;
  limit?: number;
  action?: string;
  actor?: string;
  outcome?: string;
  from?: string;
  to?: string;
}

export interface ChainVerification {
  ok: boolean;
  checked: number;
  firstBrokenId?: string;
  reason?: 'sequence_gap' | 'prev_hash_mismatch' | 'hash_mismatch';
}

/** Audit log (spec §7.18), admin only. */
export const auditApi = apiSlice.injectEndpoints({
  endpoints: (build) => ({
    listAuditLogs: build.query<{ items: AuditEntry[]; meta: PageMeta }, AuditListParams>({
      query: (params) => ({ url: '/audit-logs', params }),
      transformResponse: (res: ApiSuccess<AuditEntry[]>) => ({
        items: res.data,
        meta: res.meta as unknown as PageMeta,
      }),
      providesTags: ['AuditLog'],
    }),
    verifyAuditChain: build.mutation<ChainVerification, void>({
      query: () => ({ url: '/audit-logs/verify' }),
      transformResponse: (res: ApiSuccess<ChainVerification>) => res.data,
      invalidatesTags: ['AuditLog'], // verifying is itself audited
    }),
  }),
});

export const { useListAuditLogsQuery, useVerifyAuditChainMutation } = auditApi;
