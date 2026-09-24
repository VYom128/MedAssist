import { Printer } from 'lucide-react';
import { useParams } from 'react-router-dom';
import Button from '../../../components/ui/Button';
import ErrorState from '../../../components/ui/ErrorState';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import PageHeader from '../../../components/ui/PageHeader';
import { GENDER_SHORT } from '../../../constants/catalog';
import { formatDate } from '../../../utils/dates';
import { useGetPublicSettingsQuery } from '../../settings/api';
import { useGetPrescriptionQuery } from '../api';
import { itemLine } from '../format';

/**
 * /doctor/prescriptions/:id/print – a print-friendly prescription (window.print(); only the
 * sheet is printed, see `.print-area` in index.css). Server PDFs come in Phase 10.
 */
export default function PrescriptionPrintPage() {
  const { id = '' } = useParams();
  const { data, isLoading, isError, error, refetch } = useGetPrescriptionQuery(id);
  const { data: clinic } = useGetPublicSettingsQuery();
  return (
    <section className="space-y-6">
      <PageHeader
        back={{ to: '/doctor/queue', label: 'My queue' }}
        title="Print prescription"
        actions={
          data ? (
            <Button onClick={() => window.print()}>
              <Printer className="h-4 w-4" aria-hidden="true" /> Print
            </Button>
          ) : undefined
        }
      />
      {isLoading && <ListSkeleton label="Loading prescription…" rows={3} />}
      {isError && <ErrorState error={error} onRetry={() => void refetch()} />}
      {data && (
        <article
          aria-label="Prescription sheet"
          className="print-area mx-auto max-w-3xl space-y-5 rounded-card border border-line bg-surface p-6 text-sm shadow-card sm:p-8"
        >
          <header className="border-b border-line pb-3">
            <p className="text-section text-ink">{clinic?.name ?? 'Clinic'}</p>
            {clinic?.address?.city && <p className="text-muted">{clinic.address.city}</p>}
          </header>
          <div className="grid gap-2 sm:grid-cols-2">
            <p>
              <span className="text-muted">Patient: </span>
              {data.patient?.fullName} ({data.patient?.mrn})
              {data.patient
                ? ` · ${data.patient.age} y · ${GENDER_SHORT[data.patient.gender]}`
                : ''}
            </p>
            <p className="sm:text-right">
              <span className="text-muted">Date: </span>
              {data.issuedAt ? formatDate(data.issuedAt) : 'Not issued'}
            </p>
            <p>
              <span className="text-muted">Doctor: </span>Dr {data.doctor.name}
            </p>
            <p className="tabular sm:text-right">{data.prescriptionNumber}</p>
          </div>
          <div>
            <p className="text-card text-ink">Rx</p>
            <ol className="mt-2 space-y-2">
              {data.items.map((item, i) => (
                <li key={i}>
                  <p className="font-semibold">
                    {i + 1}. {item.drugName}
                    {item.strength ? ` ${item.strength}` : ''}
                  </p>
                  <p>{itemLine(item)}</p>
                  {item.instructions && <p className="text-muted">{item.instructions}</p>}
                </li>
              ))}
            </ol>
          </div>
          {data.generalInstructions && (
            <p>
              <span className="text-muted">Instructions: </span>
              {data.generalInstructions}
            </p>
          )}
          <p className="pt-10 text-right text-muted">Signature: ____________________</p>
        </article>
      )}
    </section>
  );
}
