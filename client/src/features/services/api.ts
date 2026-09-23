import { apiSlice } from '../../app/apiSlice';
import type { ServiceType } from '../../constants/catalog';
import { toPaged, type ApiSuccess, type Paged } from '../../utils/http';

/** Admin view of a service (spec §6.7). Money in paise, tax in basis points. */
export interface AdminService {
  id: string;
  code: string;
  name: string;
  department: { id: string; name: string; code: string } | null;
  type: ServiceType;
  durationMinutes: number;
  pricePaise: number;
  /** null = the clinic default rate. */
  taxRateBps: number | null;
  isActive: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ServiceListParams {
  page?: number;
  limit?: number;
  q?: string;
  department?: string;
  type?: ServiceType;
  includeInactive?: boolean;
  isActive?: boolean;
}

export interface ServiceInput {
  code: string;
  name: string;
  department: string | null;
  type: ServiceType;
  durationMinutes: number;
  pricePaise: number;
  taxRateBps: number | null;
}

const listTag = { type: 'Service' as const, id: 'LIST' };

/** Billable services (spec §7.5). */
export const servicesApi = apiSlice.injectEndpoints({
  endpoints: (build) => ({
    listServices: build.query<Paged<AdminService>, ServiceListParams>({
      query: (params) => ({ url: '/services', params }),
      transformResponse: (res: ApiSuccess<AdminService[]>) => toPaged(res),
      providesTags: (result) => [
        listTag,
        ...(result?.items.map((s) => ({ type: 'Service' as const, id: s.id })) ?? []),
      ],
    }),
    createService: build.mutation<AdminService, ServiceInput>({
      query: (body) => ({ url: '/services', method: 'POST', data: body }),
      transformResponse: (res: ApiSuccess<AdminService>) => res.data,
      invalidatesTags: [listTag, 'AuditLog'],
    }),
    updateService: build.mutation<AdminService, { id: string; body: Partial<ServiceInput> }>({
      query: ({ id, body }) => ({ url: `/services/${id}`, method: 'PATCH', data: body }),
      transformResponse: (res: ApiSuccess<AdminService>) => res.data,
      invalidatesTags: (_r, _e, { id }) => [listTag, { type: 'Service', id }, 'AuditLog'],
    }),
    serviceAction: build.mutation<AdminService, { id: string; action: 'activate' | 'deactivate' }>({
      query: ({ id, action }) => ({ url: `/services/${id}/${action}`, method: 'POST' }),
      transformResponse: (res: ApiSuccess<AdminService>) => res.data,
      invalidatesTags: (_r, _e, { id }) => [listTag, { type: 'Service', id }, 'AuditLog'],
    }),
  }),
});

export const {
  useListServicesQuery,
  useCreateServiceMutation,
  useUpdateServiceMutation,
  useServiceActionMutation,
} = servicesApi;
