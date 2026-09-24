import { ChevronLeft } from 'lucide-react';
import { Link } from 'react-router-dom';

/** "‹ Patients" link above a page title, back to the list the page came from. */
export default function BackLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="mb-2 inline-flex min-h-11 items-center gap-1 rounded-control text-sm font-medium text-muted hover:text-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 md:min-h-0"
    >
      <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      {label}
    </Link>
  );
}
