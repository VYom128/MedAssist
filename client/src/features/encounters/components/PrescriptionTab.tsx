import { Pill } from 'lucide-react';
import EmptyState from '../../../components/ui/EmptyState';
import ErrorState from '../../../components/ui/ErrorState';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import StatusPill from '../../../components/ui/StatusPill';
import PrescriptionEditor from '../../prescriptions/components/PrescriptionEditor';
import PrescriptionItems from '../../prescriptions/components/PrescriptionItems';
import type { useCurrentPrescription } from '../../prescriptions/useCurrentPrescription';
import type { PrescriptionDraft } from '../../prescriptions/usePrescriptionDraft';

/**
 * The Prescription tab of the workspace: the draft editor (issued when the note is signed), or
 * the current prescription read-only once it is no longer a draft.
 */
export default function PrescriptionTab({
  current,
  draft,
}: {
  current: ReturnType<typeof useCurrentPrescription>;
  draft?: PrescriptionDraft;
}) {
  const { prescription, isLoading, isError, error, refetch } = current;
  if (isLoading) return <ListSkeleton label="Loading prescription…" rows={2} />;
  if (isError) return <ErrorState error={error} onRetry={refetch} />;
  if (draft && (!prescription || prescription.status === 'draft')) {
    return <PrescriptionEditor draft={draft} server={prescription} />;
  }
  if (!prescription) {
    return <EmptyState icon={Pill} title="No drugs prescribed" />;
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill domain="prescription" status={prescription.status} size="sm" />
        {prescription.prescriptionNumber && (
          <span className="tabular text-sm text-muted">{prescription.prescriptionNumber}</span>
        )}
      </div>
      {prescription.allergyCheckNotice && (
        <p className="text-xs text-muted">{prescription.allergyCheckNotice}</p>
      )}
      <PrescriptionItems prescription={prescription} />
      {prescription.generalInstructions && (
        <p className="text-sm">
          <span className="text-muted">Instructions: </span>
          {prescription.generalInstructions}
        </p>
      )}
    </div>
  );
}
