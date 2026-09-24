import { Pill } from 'lucide-react';
import EmptyState from '../../../components/ui/EmptyState';
import ErrorState from '../../../components/ui/ErrorState';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import StatusPill from '../../../components/ui/StatusPill';
import PrescriptionItems from '../../prescriptions/components/PrescriptionItems';
import type { useCurrentPrescription } from '../../prescriptions/useCurrentPrescription';

/**
 * The Prescription tab of the workspace: the note's current prescription with its allergy
 * warnings. Drugs in the draft are issued when the note is signed. (The drug editor is a
 * separate component added to this tab.)
 */
export default function PrescriptionTab({
  current,
}: {
  current: ReturnType<typeof useCurrentPrescription>;
}) {
  const { prescription, isLoading, isError, error, refetch } = current;
  if (isLoading) return <ListSkeleton label="Loading prescription…" rows={2} />;
  if (isError) return <ErrorState error={error} onRetry={refetch} />;
  if (!prescription) {
    return (
      <EmptyState
        icon={Pill}
        title="No drugs prescribed"
        description="Drugs added to this visit are issued when you sign the note."
      />
    );
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
