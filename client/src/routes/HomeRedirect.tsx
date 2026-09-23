import { Navigate } from 'react-router-dom';
import { useAppSelector } from '../app/hooks';
import { ROLE_HOME } from '../constants/roles';
import { selectCurrentUser } from '../features/auth/authSlice';

/** "/" → the user's role dashboard. Rendered inside ProtectedRoute. */
export default function HomeRedirect() {
  const user = useAppSelector(selectCurrentUser);
  return <Navigate to={user ? ROLE_HOME[user.role] : '/login'} replace />;
}
