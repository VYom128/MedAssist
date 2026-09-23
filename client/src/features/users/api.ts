import { apiSlice } from '../../app/apiSlice';
import type { PageMeta } from '../../components/ui/Pagination';
import type { Role } from '../../constants/roles';
import type { ApiSuccess } from '../../utils/http';
import type { StaffFormValues, UserEditValues } from './schemas';

/** `toAdminView` on the server. */
export interface AdminUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  role: Role;
  isActive: boolean;
  isLocked: boolean;
  lockUntil: string | null;
  failedLoginAttempts: number;
  mustChangePassword: boolean;
  emailVerifiedAt: string | null;
  lastLoginAt: string | null;
  patientId: string | null;
  patientLinkStatus: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface UserListParams {
  page?: number;
  limit?: number;
  role?: Role;
  isActive?: boolean;
  q?: string;
  sort?: string;
}

export interface Paged<T> {
  items: T[];
  meta: PageMeta;
}

const listTag = { type: 'User' as const, id: 'LIST' };

/** Admin user management (spec §7.3). */
export const usersApi = apiSlice.injectEndpoints({
  endpoints: (build) => ({
    listUsers: build.query<Paged<AdminUser>, UserListParams>({
      query: (params) => ({ url: '/users', params }),
      transformResponse: (res: ApiSuccess<AdminUser[]>) => ({
        items: res.data,
        meta: res.meta as unknown as PageMeta,
      }),
      providesTags: (result) => [
        listTag,
        ...(result?.items.map((u) => ({ type: 'User' as const, id: u.id })) ?? []),
      ],
    }),
    getUser: build.query<AdminUser, string>({
      query: (id) => ({ url: `/users/${id}` }),
      transformResponse: (res: ApiSuccess<AdminUser>) => res.data,
      providesTags: (_r, _e, id) => [{ type: 'User', id }],
    }),
    createUser: build.mutation<AdminUser, StaffFormValues>({
      query: (body) => ({ url: '/users', method: 'POST', data: body }),
      transformResponse: (res: ApiSuccess<AdminUser>) => res.data,
      invalidatesTags: [listTag],
    }),
    updateUser: build.mutation<AdminUser, { id: string; body: Partial<UserEditValues> }>({
      query: ({ id, body }) => ({ url: `/users/${id}`, method: 'PATCH', data: body }),
      transformResponse: (res: ApiSuccess<AdminUser>) => res.data,
      invalidatesTags: (_r, _e, { id }) => [listTag, { type: 'User', id }],
    }),
    userAction: build.mutation<
      string,
      { id: string; action: 'deactivate' | 'activate' | 'unlock' | 'reset-password' }
    >({
      query: ({ id, action }) => ({ url: `/users/${id}/${action}`, method: 'POST' }),
      transformResponse: (res: ApiSuccess<unknown>) => res.message,
      invalidatesTags: (_r, _e, { id }) => [listTag, { type: 'User', id }, 'AuditLog'],
    }),
  }),
});

export const {
  useListUsersQuery,
  useGetUserQuery,
  useCreateUserMutation,
  useUpdateUserMutation,
  useUserActionMutation,
} = usersApi;
