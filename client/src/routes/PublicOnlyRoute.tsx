import { Navigate, Outlet } from 'react-router-dom';
import { useAppSelector } from '../app/hooks';
import FullPageLoader from '../components/FullPageLoader';
import { ROLE_HOME } from '../constants/roles';
import { selectAuth } from '../features/auth/authSlice';

/** Login/register/password-reset pages: a signed-in user goes to their dashboard. */
export default function PublicOnlyRoute() {
  const { status, user } = useAppSelector(selectAuth);
  if (status === 'restoring') return <FullPageLoader />;
  if (status === 'authenticated' && user) return <Navigate to={ROLE_HOME[user.role]} replace />;
  return <Outlet />;
}
