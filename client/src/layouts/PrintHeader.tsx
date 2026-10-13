import { useGetPublicSettingsQuery } from '../features/settings/api';
import { formatDateTime } from '../utils/dates';

/**
 * Clinic header for printed app pages (Phase 10: reports, the daily appointment list, the queue):
 * clinic name and address, the page title, an optional line (e.g. the date range) and when it
 * was printed, in clinic time. Invisible on screen; the shell around it is hidden by
 * `print:hidden` and the print rules in index.css.
 */
export default function PrintHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  const { data: clinic } = useGetPublicSettingsQuery();
  const address = clinic
    ? [clinic.address.line1, clinic.address.city, clinic.address.state, clinic.address.postalCode]
        .filter(Boolean)
        .join(', ')
    : '';
  // The time this header rendered: close enough to "printed at" (a print re-renders nothing).
  const printedAt = formatDateTime(new Date());
  return (
    <div
      data-testid="print-header"
      className="print-header mb-6 hidden border-b border-ink pb-3 print:block"
    >
      <div className="flex items-start justify-between gap-6">
        <div>
          <p className="text-lg font-bold">{clinic?.name ?? 'MedAssist'}</p>
          {address && <p className="text-xs">{address}</p>}
          {clinic?.phone && <p className="text-xs">{clinic.phone}</p>}
        </div>
        <p className="text-right text-xs">Printed {printedAt}</p>
      </div>
      <p className="mt-3 text-base font-semibold">{title}</p>
      {subtitle && <p className="text-sm">{subtitle}</p>}
    </div>
  );
}
