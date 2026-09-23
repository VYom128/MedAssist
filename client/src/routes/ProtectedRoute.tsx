import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAppSelector } from '../app/hooks';
import FullPageLoader from '../components/FullPageLoader';
import { selectAuth } from '../features/auth/authSlice';

/**
 * Logged-in area (spec §13.1): waits for the session restore, sends guests to /login?next=…,
 * and keeps users who must change their password on /change-password.
 */
export default function ProtectedRoute() {
  const { status, user } = useAppSelector(selectAuth);
  const location = useLocation();

  if (status === 'restoring') return <FullPageLoader />;

  if (status === 'guest' || !user) {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }

  if (user.mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }

  return <Outlet />;
}
