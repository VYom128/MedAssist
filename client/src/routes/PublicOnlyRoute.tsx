import { Navigate, Outlet } from 'react-router-dom';
import { useAppSelector } from '../app/hooks';
import { ROLE_HOME } from '../constants/roles';
import { selectAuth } from '../features/auth/authSlice';

/** Login/register pages: a user who is already signed in goes to their dashboard. */
export default function PublicOnlyRoute() {
  const { status, user } = useAppSelector(selectAuth);
  if (status === 'authenticated' && user) return <Navigate to={ROLE_HOME[user.role]} replace />;
  return <Outlet />;
}
