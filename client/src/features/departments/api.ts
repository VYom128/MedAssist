import { apiSlice } from '../../app/apiSlice';
import { toPaged, type ApiSuccess, type Paged } from '../../utils/http';

/** Public department (GET /departments). */
export interface Department {
  id: string;
  name: string;
  code: string;
  description: string | null;
}

/** Admin view: status, timestamps and the number of active doctors. */
export interface AdminDepartment extends Department {
  isActive: boolean;
  activeDoctors: number;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface DepartmentListParams {
  page?: number;
  limit?: number;
  q?: string;
  includeInactive?: boolean;
}

export interface DepartmentInput {
  name: string;
  code: string;
  description: string;
}

const listTag = { type: 'Department' as const, id: 'LIST' };

/** Departments (spec §7.5). */
export const departmentsApi = apiSlice.injectEndpoints({
  endpoints: (build) => ({
    listDepartments: build.query<Paged<AdminDepartment>, DepartmentListParams>({
      query: (params) => ({ url: '/departments', params }),
      transformResponse: (res: ApiSuccess<AdminDepartment[]>) => toPaged(res),
      providesTags: (result) => [
        listTag,
        ...(result?.items.map((d) => ({ type: 'Department' as const, id: d.id })) ?? []),
      ],
    }),
    createDepartment: build.mutation<AdminDepartment, DepartmentInput>({
      query: (body) => ({ url: '/departments', method: 'POST', data: body }),
      transformResponse: (res: ApiSuccess<AdminDepartment>) => res.data,
      invalidatesTags: [listTag, 'AuditLog'],
    }),
    updateDepartment: build.mutation<
      AdminDepartment,
      { id: string; body: Partial<DepartmentInput> }
    >({
      query: ({ id, body }) => ({ url: `/departments/${id}`, method: 'PATCH', data: body }),
      transformResponse: (res: ApiSuccess<AdminDepartment>) => res.data,
      // Services and doctors show the department name.
      invalidatesTags: (_r, _e, { id }) => [
        listTag,
        { type: 'Department', id },
        'Service',
        'Doctor',
        'AuditLog',
      ],
    }),
    departmentAction: build.mutation<
      AdminDepartment,
      { id: string; action: 'activate' | 'deactivate' }
    >({
      query: ({ id, action }) => ({ url: `/departments/${id}/${action}`, method: 'POST' }),
      transformResponse: (res: ApiSuccess<AdminDepartment>) => res.data,
      invalidatesTags: (_r, _e, { id }) => [
        listTag,
        { type: 'Department', id },
        'Service',
        'AuditLog',
      ],
    }),
  }),
});

export const {
  useListDepartmentsQuery,
  useCreateDepartmentMutation,
  useUpdateDepartmentMutation,
  useDepartmentActionMutation,
} = departmentsApi;
