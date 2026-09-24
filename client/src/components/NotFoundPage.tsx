import { Link } from 'react-router-dom';
import { buttonClass } from './ui/buttonClass';

export default function NotFoundPage() {
  return (
    <section className="mx-auto max-w-md px-4 py-16 text-center">
      <p className="tabular text-caption text-primary-700 uppercase">404</p>
      <h1 className="mt-2 text-page">Page not found</h1>
      <p className="mt-2 text-sm text-muted">The page you are looking for does not exist.</p>
      <Link to="/" className={`mt-6 ${buttonClass()}`}>
        Go home
      </Link>
    </section>
  );
}
