import { apiSlice } from '../../app/apiSlice';
import type { ApiSuccess } from '../../utils/http';
import { credentialsReceived, loggedOut, userUpdated, type CurrentUser } from './authSlice';
import type {
  ChangePasswordValues,
  ForgotPasswordValues,
  LoginValues,
  ProfileValues,
} from './schemas';

interface AuthPayload {
  accessToken: string;
  expiresIn: number;
  user: CurrentUser;
}

/** Sign-up result (spec §4.4): whether the account is linked to a record or waits for an ID check. */
export interface RegisterPayload extends AuthPayload {
  link: { status: 'linked' | 'pending_verification'; message: string };
}

/** POST /auth/register body. */
export interface RegisterBody {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  password: string;
  acceptTerms: true;
  consent: { dataProcessing: true };
}

export interface SessionInfo {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string | null;
  lastUsedAt: string | null;
  expiresAt: string;
  current: boolean;
}

/** Stores the access token and user after login/register/change-password. */
const storeCredentials = async (
  _arg: unknown,
  {
    dispatch,
    queryFulfilled,
  }: {
    dispatch: (a: unknown) => unknown;
    queryFulfilled: Promise<{ data: AuthPayload }>;
  },
) => {
  try {
    const { data } = await queryFulfilled;
    dispatch(credentialsReceived({ accessToken: data.accessToken, user: data.user }));
  } catch {
    // The page shows the error from the mutation result.
  }
};

/** Auth endpoints (spec §7.2). */
export const authApi = apiSlice.injectEndpoints({
  endpoints: (build) => ({
    login: build.mutation<AuthPayload, LoginValues>({
      query: (body) => ({ url: '/auth/login', method: 'POST', data: body }),
      transformResponse: (res: ApiSuccess<AuthPayload>) => res.data,
      onQueryStarted: storeCredentials,
    }),
    // The page stores the credentials itself, in the same tick as it navigates: it decides where
    // the new patient lands (dashboard, or the ID-check screen when the link is pending).
    register: build.mutation<RegisterPayload, RegisterBody>({
      query: (body) => ({ url: '/auth/register', method: 'POST', data: body }),
      transformResponse: (res: ApiSuccess<RegisterPayload>) => res.data,
    }),
    logout: build.mutation<void, void>({
      query: () => ({ url: '/auth/logout', method: 'POST' }),
      transformResponse: () => undefined,
      // Log out locally even if the server call fails (e.g. session already gone).
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        await queryFulfilled.catch(() => undefined);
        dispatch(loggedOut());
      },
    }),
    logoutAll: build.mutation<{ sessionsRevoked: number }, void>({
      query: () => ({ url: '/auth/logout-all', method: 'POST' }),
      transformResponse: (res: ApiSuccess<{ sessionsRevoked: number }>) => res.data,
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        await queryFulfilled.catch(() => undefined);
        dispatch(loggedOut());
      },
    }),
    getMe: build.query<CurrentUser, void>({
      query: () => ({ url: '/auth/me' }),
      transformResponse: (res: ApiSuccess<CurrentUser>) => res.data,
      providesTags: ['Me'],
    }),
    updateMe: build.mutation<CurrentUser, ProfileValues>({
      query: (body) => ({ url: '/auth/me', method: 'PATCH', data: body }),
      transformResponse: (res: ApiSuccess<CurrentUser>) => res.data,
      invalidatesTags: ['Me'],
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          dispatch(userUpdated(data));
        } catch {
          // shown by the form
        }
      },
    }),
    changePassword: build.mutation<AuthPayload, Omit<ChangePasswordValues, 'confirmPassword'>>({
      query: (body) => ({ url: '/auth/change-password', method: 'POST', data: body }),
      transformResponse: (res: ApiSuccess<AuthPayload>) => res.data,
      invalidatesTags: ['Session', 'Me'],
      onQueryStarted: storeCredentials,
    }),
    forgotPassword: build.mutation<string, ForgotPasswordValues>({
      query: (body) => ({ url: '/auth/forgot-password', method: 'POST', data: body }),
      transformResponse: (res: ApiSuccess<null>) => res.message,
    }),
    resetPassword: build.mutation<string, { token: string; newPassword: string }>({
      query: (body) => ({ url: '/auth/reset-password', method: 'POST', data: body }),
      transformResponse: (res: ApiSuccess<null>) => res.message,
    }),
    getSessions: build.query<SessionInfo[], void>({
      query: () => ({ url: '/auth/sessions' }),
      transformResponse: (res: ApiSuccess<SessionInfo[]>) => res.data,
      providesTags: ['Session'],
    }),
    revokeSession: build.mutation<void, string>({
      query: (id) => ({ url: `/auth/sessions/${id}`, method: 'DELETE' }),
      transformResponse: () => undefined,
      invalidatesTags: ['Session'],
    }),
  }),
});

export const {
  useLoginMutation,
  useRegisterMutation,
  useLogoutMutation,
  useLogoutAllMutation,
  useGetMeQuery,
  useUpdateMeMutation,
  useChangePasswordMutation,
  useForgotPasswordMutation,
  useResetPasswordMutation,
  useGetSessionsQuery,
  useRevokeSessionMutation,
} = authApi;
