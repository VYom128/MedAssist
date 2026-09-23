import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { Role } from '../../constants/roles';

/** The logged-in user as returned by the server (`toSelfView`). */
export interface CurrentUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  role: Role;
  mustChangePassword: boolean;
  emailVerifiedAt: string | null;
  lastLoginAt: string | null;
  avatarUrl: string | null;
  /** Linked patient record: only once the link is confirmed (spec §4.4). */
  patientId: string | null;
  /** Patients: 'pending_verification' until reception has checked their identity. */
  patientLinkStatus: 'linked' | 'pending_verification' | null;
  doctorProfileId: string | null;
}

export interface AuthState {
  user: CurrentUser | null;
  /** Kept in memory only – never localStorage (spec §10.1). */
  accessToken: string | null;
  /** restoring (page load: exchanging the refresh cookie) → authenticated | guest */
  status: 'restoring' | 'authenticated' | 'guest';
}

const initialState: AuthState = { user: null, accessToken: null, status: 'restoring' };

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    credentialsReceived(state, action: PayloadAction<{ accessToken: string; user: CurrentUser }>) {
      state.accessToken = action.payload.accessToken;
      state.user = action.payload.user;
      state.status = 'authenticated';
    },
    userUpdated(state, action: PayloadAction<CurrentUser>) {
      state.user = action.payload;
    },
    loggedOut() {
      return { user: null, accessToken: null, status: 'guest' as const };
    },
  },
});

export const { credentialsReceived, userUpdated, loggedOut } = authSlice.actions;
export default authSlice.reducer;

export const selectAuth = (state: { auth: AuthState }) => state.auth;
export const selectCurrentUser = (state: { auth: AuthState }) => state.auth.user;
