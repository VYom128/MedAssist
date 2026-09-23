import { Link } from 'react-router-dom';

export default function ForbiddenPage() {
  return (
    <section className="mx-auto max-w-md text-center">
      <p className="text-sm font-semibold text-brand-600">403</p>
      <h1 className="mt-2 text-2xl font-semibold">You don't have access to this page</h1>
      <p className="mt-2 text-slate-500">This area is for a different role.</p>
      <Link
        to="/"
        className="mt-6 inline-block rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
      >
        Go to my dashboard
      </Link>
    </section>
  );
}
