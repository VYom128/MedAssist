import { ChevronLeft, ChevronRight } from 'lucide-react';
import Button from './Button';

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/** "Showing 21–40 of 95" with previous/next buttons. */
export default function Pagination({
  meta,
  onPageChange,
}: {
  meta: PageMeta;
  onPageChange: (page: number) => void;
}) {
  if (meta.total === 0) return null;
  const from = (meta.page - 1) * meta.limit + 1;
  const to = Math.min(meta.page * meta.limit, meta.total);
  return (
    <nav
      aria-label="Pagination"
      className="mt-4 flex flex-col items-center justify-between gap-3 text-sm text-slate-600 sm:flex-row"
    >
      <p>
        Showing <span className="font-medium">{from}</span>–
        <span className="font-medium">{to}</span> of{' '}
        <span className="font-medium">{meta.total}</span>
      </p>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          onClick={() => onPageChange(meta.page - 1)}
          disabled={meta.page <= 1}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Previous
        </Button>
        <Button
          variant="secondary"
          onClick={() => onPageChange(meta.page + 1)}
          disabled={meta.page >= meta.totalPages}
          aria-label="Next page"
        >
          Next <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}
