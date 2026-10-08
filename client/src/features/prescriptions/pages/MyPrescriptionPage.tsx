import { Pill, Printer } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import EmptyState from '../../../components/ui/EmptyState';
import ErrorState from '../../../components/ui/ErrorState';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import PageHeader from '../../../components/ui/PageHeader';
import SectionCard from '../../../components/ui/SectionCard';
import StatusPill from '../../../components/ui/StatusPill';
import { buttonClass } from '../../../components/ui/buttonClass';
import { linkClass } from '../../../components/ui/linkClass';
import { formatDate } from '../../../utils/dates';
import { isApiQueryError } from '../../../utils/http';
import { useGetPrescriptionQuery } from '../api';
import { plainItem } from '../format';

/**
 * /patient/prescriptions/:id – the patient's prescription in plain words ("1 tablet, twice a
 * day, after food, for 5 days") with a print button (the existing print page).
 */
export default function MyPrescriptionPage() {
  const { id = '' } = useParams();
  const rx = useGetPrescriptionQuery(id);
  const back = { to: '/patient/prescriptions', label: 'My prescriptions' };
  const p = rx.data;

  if (rx.isLoading) {
    return (
      <section className="mx-auto w-full max-w-5xl">
        <PageHeader back={back} title="Prescription" />
        <ListSkeleton label="Loading the prescription…" rows={3} />
      </section>
    );
  }
  if (!p) {
    const notFound = isApiQueryError(rx.error) && rx.error.status === 404;
    return (
      <section className="mx-auto w-full max-w-5xl">
        <PageHeader back={back} title="Prescription" />
        {notFound ? (
          <EmptyState icon={Pill} title="Prescription not found" />
        ) : (
          <ErrorState error={rx.error} onRetry={() => void rx.refetch()} />
        )}
      </section>
    );
  }

  return (
    <section className="mx-auto w-full max-w-5xl space-y-6">
      <PageHeader
        back={back}
        title={`Prescription ${p.prescriptionNumber ?? ''}`.trim()}
        description={`Dr ${p.doctor.name}${p.issuedAt ? ` · ${formatDate(p.issuedAt)}` : ''}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill domain="prescription" status={p.status} />
            <Link to={`/print/prescriptions/${p.id}`} className={buttonClass('secondary', 'sm')}>
              <Printer className="h-4 w-4" aria-hidden="true" /> Print
            </Link>
          </div>
        }
      />
      <SectionCard title="Medicines" icon={Pill} iconTone="primary">
        <ul className="divide-y divide-line">
          {p.items.map((item, i) => (
            <li key={i} className="py-3 first:pt-0 last:pb-0">
              <p className="font-semibold text-ink">
                {item.drugName}
                {item.strength ? ` ${item.strength}` : ''}
              </p>
              <p className="text-sm text-body">{plainItem(item) || 'As directed'}</p>
              {item.instructions && <p className="text-sm text-muted">{item.instructions}</p>}
            </li>
          ))}
        </ul>
        {p.generalInstructions && (
          <p className="mt-4 rounded-control bg-surface-muted p-3 text-sm whitespace-pre-line text-body">
            {p.generalInstructions}
          </p>
        )}
        {/* Phase 9 adds "Explain in simple words" here (AI, spec §9.3). */}
      </SectionCard>
      <p className="text-sm text-muted">
        Questions about your medicines?{' '}
        <Link to={`/patient/visits/${p.encounterId}`} className={linkClass}>
          See the visit summary
        </Link>{' '}
        or ask the clinic.
      </p>
    </section>
  );
}
