import { useParams } from 'react-router-dom';
import ErrorState from '../../../components/ui/ErrorState';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import { GENDER_SHORT } from '../../../constants/catalog';
import PrintLayout from '../../../layouts/PrintLayout';
import { formatDateTime } from '../../../utils/dates';
import { useGetLabOrderQuery } from '../api';
import { openItems } from '../format';

/**
 * /print/lab-labels/:id – the sample tube label (spec §13.4 #6): the sample ID in large
 * monospaced type (no barcode library is installed – see the phase notes), patient name, MRN,
 * age/sex, order number, tests and collection time, sized for a 50 × 30 mm label.
 */
export default function PrintSampleLabelPage() {
  const { id = '' } = useParams();
  const { data: order, isLoading, isError, error, refetch } = useGetLabOrderQuery(id);
  return (
    <PrintLayout title="Sample label">
      {isLoading && <ListSkeleton label="Loading the label…" rows={2} />}
      {isError && <ErrorState error={error} onRetry={() => void refetch()} />}
      {order && !order.sample?.sampleId && (
        <p className="text-sm text-muted">No sample has been collected for this order yet.</p>
      )}
      {order?.sample?.sampleId && (
        <div
          aria-label="Sample label"
          className="w-[50mm] space-y-0.5 rounded border border-ink p-[2mm] font-sans text-[8pt] leading-tight text-black print:rounded-none"
        >
          <p className="font-mono text-[16pt] font-bold tracking-wider">{order.sample.sampleId}</p>
          <p className="font-bold">{order.patient.fullName}</p>
          <p>
            {order.patient.mrn} · {order.sample.patientAgeYears ?? order.patient.age} y ·{' '}
            {GENDER_SHORT[order.patient.gender]}
            {order.priority === 'urgent' ? ' · URGENT' : ''}
          </p>
          <p>{order.orderNumber}</p>
          <p>
            {openItems(order)
              .map((i) => i.code)
              .join(', ')}
          </p>
          {order.sample.collectedAt && <p>{formatDateTime(order.sample.collectedAt)}</p>}
        </div>
      )}
    </PrintLayout>
  );
}
