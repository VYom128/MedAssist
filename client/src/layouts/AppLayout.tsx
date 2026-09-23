import { Link, Outlet } from 'react-router-dom';
import { env } from '../utils/env';

/** Minimal shell for Phase 0. The role-based sidebar arrives in Phase 1. */
export default function AppLayout() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-14 max-w-6xl items-center px-4">
          <Link to="/" className="text-lg font-semibold text-brand-700">
            {env.appName}
          </Link>
        </div>
      </header>
      <main className="flex-1 px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
