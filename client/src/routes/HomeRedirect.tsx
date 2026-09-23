import { Navigate } from 'react-router-dom';
import { useAppSelector } from '../app/hooks';
import FullPageLoader from '../components/FullPageLoader';
import { selectAuth } from '../features/auth/authSlice';
import { homeFor } from './home';

/** "/" → where the user starts (homeFor) when signed in, otherwise /login. */
export default function HomeRedirect() {
  const { status, user } = useAppSelector(selectAuth);
  if (status === 'restoring') return <FullPageLoader />;
  return <Navigate to={user ? homeFor(user) : '/login'} replace />;
}
