import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import NotFoundPage from '../components/NotFoundPage';
import HomePage from '../features/health/pages/HomePage';
import AppLayout from '../layouts/AppLayout';

const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);

export default function AppRoutes() {
  return <RouterProvider router={router} />;
}
