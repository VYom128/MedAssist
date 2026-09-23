import { createApi } from '@reduxjs/toolkit/query/react';
import { axiosBaseQuery } from './axiosBaseQuery';

/** Single RTK Query API; features add endpoints with `apiSlice.injectEndpoints` (spec §13.2). */
export const apiSlice = createApi({
  reducerPath: 'api',
  baseQuery: axiosBaseQuery,
  tagTypes: ['Me', 'Session', 'User', 'AuditLog'],
  endpoints: () => ({}),
});
