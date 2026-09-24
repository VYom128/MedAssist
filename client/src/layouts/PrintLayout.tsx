import { ArrowLeft, Printer } from 'lucide-react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import Button from '../components/ui/Button';

/**
 * A printable page without the app shell (spec §12.3): a toolbar (hidden when printing) with Back
 * and Print (`window.print()`), then an A4-width sheet. `controls` add options to the toolbar.
 */
export default function PrintLayout({
  title,
  controls,
  children,
}: {
  title: string;
  controls?: ReactNode;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-canvas print:bg-white">
      <div className="border-b border-line bg-surface print:hidden">
        <div className="mx-auto flex max-w-[210mm] flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back
            </Button>
            <h1 className="text-card text-ink">{title}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {controls}
            <Button onClick={() => window.print()}>
              <Printer className="h-4 w-4" aria-hidden="true" /> Print
            </Button>
          </div>
        </div>
      </div>
      <main className="mx-auto max-w-[210mm] px-4 py-6 print:max-w-none print:p-0">
        <article className="min-h-[297mm] bg-white p-[14mm] text-sm text-ink shadow-card print:min-h-0 print:p-0 print:shadow-none">
          {children}
        </article>
      </main>
    </div>
  );
}
