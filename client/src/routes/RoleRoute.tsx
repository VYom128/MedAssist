import { Navigate, Outlet } from 'react-router-dom';
import { useAppSelector } from '../app/hooks';
import type { Role } from '../constants/roles';
import { selectCurrentUser } from '../features/auth/authSlice';

/** Only lets the given roles through; others see /403. Must sit inside ProtectedRoute. */
export default function RoleRoute({ roles }: { roles: readonly Role[] }) {
  const user = useAppSelector(selectCurrentUser);
  if (!user || !roles.includes(user.role)) return <Navigate to="/403" replace />;
  return <Outlet />;
}
