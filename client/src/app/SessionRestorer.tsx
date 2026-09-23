import { useEffect, type ReactNode } from 'react';
import { refreshSession } from './axiosBaseQuery';
import { useAppDispatch } from './hooks';

/**
 * On page load, exchanges the refresh cookie for an access token (spec §10.1), since the access
 * token lives only in memory. Auth status starts as 'restoring'; the shared refresh promise makes
 * StrictMode's double effect harmless (one request).
 */
export default function SessionRestorer({ children }: { children: ReactNode }) {
  const dispatch = useAppDispatch();
  useEffect(() => {
    void refreshSession(dispatch);
  }, [dispatch]);
  return children;
}
