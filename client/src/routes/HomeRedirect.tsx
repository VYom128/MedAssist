import { Navigate } from 'react-router-dom';
import { useAppSelector } from '../app/hooks';
import FullPageLoader from '../components/FullPageLoader';
import { ROLE_HOME } from '../constants/roles';
import { selectAuth } from '../features/auth/authSlice';

/** "/" → the user's role dashboard when signed in, otherwise /login. */
export default function HomeRedirect() {
  const { status, user } = useAppSelector(selectAuth);
  if (status === 'restoring') return <FullPageLoader />;
  return <Navigate to={user ? ROLE_HOME[user.role] : '/login'} replace />;
}
