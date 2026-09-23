import { useEffect, type ReactNode } from 'react';
import { sessionRestoreStarted } from '../features/auth/authSlice';
import { refreshSession } from './axiosBaseQuery';
import { useAppDispatch } from './hooks';

/**
 * On page load, exchanges the refresh cookie for an access token (spec §10.1), since the access
 * token lives only in memory. The shared refresh mutex makes StrictMode's double effect harmless.
 */
export default function SessionRestorer({ children }: { children: ReactNode }) {
  const dispatch = useAppDispatch();
  useEffect(() => {
    dispatch(sessionRestoreStarted());
    void refreshSession(dispatch);
  }, [dispatch]);
  return children;
}
