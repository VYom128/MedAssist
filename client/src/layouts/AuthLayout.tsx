import { Link, Outlet } from 'react-router-dom';
import { env } from '../utils/env';

/** Public pages (login, register, password reset): centred card. */
export default function AuthLayout() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="px-4 py-5">
        <Link to="/login" className="text-lg font-semibold text-brand-700">
          {env.appName}
        </Link>
      </header>
      <main className="flex flex-1 justify-center px-4 pb-12 sm:items-center">
        <Outlet />
      </main>
      <footer className="px-4 py-4 text-center text-xs text-slate-400">
        <Link to="/status" className="hover:underline">
          System status
        </Link>
      </footer>
    </div>
  );
}
