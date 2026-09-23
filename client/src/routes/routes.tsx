import type { ComponentType } from 'react';
import type { RouteObject } from 'react-router-dom';
import ForbiddenPage from '../components/ForbiddenPage';
import NotFoundPage from '../components/NotFoundPage';
import { ROLE_BASE, ROLES, type Role } from '../constants/roles';
import ChangePasswordPage from '../features/auth/pages/ChangePasswordPage';
import ForgotPasswordPage from '../features/auth/pages/ForgotPasswordPage';
import LoginPage from '../features/auth/pages/LoginPage';
import ProfilePage from '../features/auth/pages/ProfilePage';
import RegisterPage from '../features/auth/pages/RegisterPage';
import ResetPasswordPage from '../features/auth/pages/ResetPasswordPage';
import SessionsPage from '../features/auth/pages/SessionsPage';
import HomePage from '../features/health/pages/HomePage';
import AppLayout from '../layouts/AppLayout';
import AuthLayout from '../layouts/AuthLayout';
import HomeRedirect from './HomeRedirect';
import ProtectedRoute from './ProtectedRoute';
import PublicOnlyRoute from './PublicOnlyRoute';
import RoleRoute from './RoleRoute';

type PageModule = { default: ComponentType };
const page = (load: () => Promise<PageModule>) => async () => ({
  Component: (await load()).default,
});

/** Each role's area is lazy-loaded (spec §13.1). Pages are added per phase. */
const ROLE_ROUTES: Record<Role, RouteObject[]> = {
  admin: [
    { path: 'dashboard', lazy: page(() => import('../features/dashboards/pages/AdminDashboard')) },
  ],
  doctor: [
    { path: 'dashboard', lazy: page(() => import('../features/dashboards/pages/DoctorDashboard')) },
  ],
  receptionist: [
    {
      path: 'dashboard',
      lazy: page(() => import('../features/dashboards/pages/ReceptionDashboard')),
    },
  ],
  labtech: [
    { path: 'dashboard', lazy: page(() => import('../features/dashboards/pages/LabDashboard')) },
  ],
  patient: [
    {
      path: 'dashboard',
      lazy: page(() => import('../features/dashboards/pages/PatientDashboard')),
    },
  ],
};

const roleAreas: RouteObject[] = Object.values(ROLES).map((role) => ({
  path: ROLE_BASE[role],
  element: <RoleRoute roles={[role]} />,
  children: ROLE_ROUTES[role],
}));

/** The route tree (spec §13.1). Rendered by AppRoutes; tests use it with a memory router. */
export const routes: RouteObject[] = [
  {
    element: <AuthLayout />,
    children: [
      {
        element: <PublicOnlyRoute />,
        children: [
          { path: '/login', element: <LoginPage /> },
          { path: '/register', element: <RegisterPage /> },
        ],
      },
      { path: '/forgot-password', element: <ForgotPasswordPage /> },
      { path: '/reset-password/:token', element: <ResetPasswordPage /> },
      { path: '/status', element: <HomePage /> },
    ],
  },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <HomeRedirect /> },
          { path: '/profile', element: <ProfilePage /> },
          { path: '/sessions', element: <SessionsPage /> },
          { path: '/change-password', element: <ChangePasswordPage /> },
          { path: '/403', element: <ForbiddenPage /> },
          ...roleAreas,
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
];
