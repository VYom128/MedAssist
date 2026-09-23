import { Navigate, Outlet } from 'react-router-dom';
import { useAppSelector } from '../app/hooks';
import FullPageLoader from '../components/FullPageLoader';
import { selectAuth } from '../features/auth/authSlice';
import { homeFor } from './home';

/** Login/register/password-reset pages: a signed-in user goes to their dashboard. */
export default function PublicOnlyRoute() {
  const { status, user } = useAppSelector(selectAuth);
  if (status === 'restoring') return <FullPageLoader />;
  if (status === 'authenticated' && user) return <Navigate to={homeFor(user)} replace />;
  return <Outlet />;
}
