import type { RouteObject } from 'react-router-dom';
import ForbiddenPage from '../components/ForbiddenPage';
import NotFoundPage from '../components/NotFoundPage';
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
import { APP_ROUTES } from './routeConfig';

/** Role pages from routeConfig, each behind RoleRoute and lazy-loaded. */
const rolePages: RouteObject[] = APP_ROUTES.map((r) => ({
  element: <RoleRoute roles={r.roles} />,
  children: [{ path: r.path, lazy: async () => ({ Component: (await r.load()).default }) }],
}));

/** The route tree (spec §13.1). Rendered by AppRoutes; tests use it with a memory router. */
export const routes: RouteObject[] = [
  { index: true, element: <HomeRedirect /> },
  {
    element: <AuthLayout />,
    children: [
      {
        // Signed-in users are sent to their dashboard.
        element: <PublicOnlyRoute />,
        children: [
          { path: '/login', element: <LoginPage /> },
          { path: '/register', element: <RegisterPage /> },
          { path: '/forgot-password', element: <ForgotPasswordPage /> },
          { path: '/reset-password/:token', element: <ResetPasswordPage /> },
        ],
      },
      { path: '/status', element: <HomePage /> },
      { path: '/404', element: <NotFoundPage /> },
    ],
  },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { path: '/profile', element: <ProfilePage /> },
          { path: '/sessions', element: <SessionsPage /> },
          { path: '/change-password', element: <ChangePasswordPage /> },
          { path: '/403', element: <ForbiddenPage /> },
          ...rolePages,
        ],
      },
    ],
  },
  // Waiting-room kiosk: public (kiosk key in the URL), full screen, no app layout (spec §13.1).
  {
    path: '/queue-board',
    lazy: async () => ({
      Component: (await import('../features/queue/pages/QueueBoardPage')).default,
    }),
  },
  { path: '*', element: <NotFoundPage /> },
];
