import { Link } from 'react-router-dom';
import { buttonClass } from './ui/buttonClass';

export default function ForbiddenPage() {
  return (
    <section className="mx-auto max-w-md text-center">
      <p className="tabular text-caption text-primary-700 uppercase">403</p>
      <h1 className="mt-2 text-page">You don't have access to this page</h1>
      <p className="mt-2 text-sm text-muted">This area is for a different role.</p>
      <Link to="/" className={`mt-6 ${buttonClass()}`}>
        Go to my dashboard
      </Link>
    </section>
  );
}
