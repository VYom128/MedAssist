import { Ban, FileCheck2, Pill, Printer, RefreshCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Link } from 'react-router-dom';
import { useAppDispatch } from '../../../app/hooks';
import Alert from '../../../components/ui/Alert';
import Button from '../../../components/ui/Button';
import { buttonClass } from '../../../components/ui/buttonClass';
import EmptyState from '../../../components/ui/EmptyState';
import ErrorState from '../../../components/ui/ErrorState';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import ReasonDialog from '../../../components/ui/ReasonDialog';
import SectionCard from '../../../components/ui/SectionCard';
import StatusPill from '../../../components/ui/StatusPill';
import { PRESCRIPTION_REASON_MIN } from '../../../constants/catalog';
import { useUnsavedChanges } from '../../../hooks/useUnsavedChanges';
import { getQueryErrorMessage, isApiQueryError } from '../../../utils/http';
import {
  useCancelPrescriptionMutation,
  useIssuePrescriptionMutation,
  useReissuePrescriptionMutation,
} from '../api';
import { rxClosed } from '../rxDraftSlice';
import { useCurrentPrescription } from '../useCurrentPrescription';
import { usePrescriptionDraft } from '../usePrescriptionDraft';
import PrescriptionEditor from './PrescriptionEditor';
import PrescriptionItems from './PrescriptionItems';

/**
 * The prescription of a signed note (spec §5.3): issued → read-only with Print, Cancel (reason)
 * and Reissue (reason → a new draft replacing it, edited here and issued with "Issue").
 * `canChange`: the note's own doctor.
 */
export default function SignedPrescription({
  encounterId,
  canChange,
}: {
  encounterId: string;
  canChange: boolean;
}) {
  const dispatch = useAppDispatch();
  const current = useCurrentPrescription(encounterId);
  const rx = current.prescription;
  const draft = usePrescriptionDraft(encounterId, rx, !current.isLoading);
  const [dialog, setDialog] = useState<'cancel' | 'reissue' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issueProblems, setIssueProblems] = useState<string[]>([]);
  const [cancel, cancelling] = useCancelPrescriptionMutation();
  const [reissue, reissuing] = useReissuePrescriptionMutation();
  const [issue, issuing] = useIssuePrescriptionMutation();
  const leaveGuard = useUnsavedChanges(draft.dirty);
  useEffect(() => () => void dispatch(rxClosed({ id: encounterId })), [dispatch, encounterId]);

  const onIssue = async () => {
    setIssueProblems([]);
    setError(null);
    if (!rx) return;
    if (!(await draft.saveNow())) {
      setError('Complete the highlighted drugs before issuing.');
      return;
    }
    try {
      await issue({ id: rx.id, expectedVersion: draft.entry?.revision ?? rx.revision }).unwrap();
      toast.success('Prescription issued');
    } catch (err) {
      setError(getQueryErrorMessage(err));
      if (isApiQueryError(err) && Array.isArray(err.details)) {
        setIssueProblems(
          (err.details as { field?: string; message?: string; drugName?: string }[]).map((d) =>
            [d.drugName ?? d.field, d.message].filter(Boolean).join(': '),
          ),
        );
      }
    }
  };

  const withReason = async (kind: 'cancel' | 'reissue', reason: string) => {
    if (!rx) return;
    setError(null);
    try {
      if (kind === 'cancel') {
        await cancel({ id: rx.id, reason }).unwrap();
        toast.success('Prescription cancelled');
      } else {
        await reissue({ id: rx.id, reason }).unwrap();
        toast.success('Prescription cancelled – edit the new draft and issue it');
      }
      setDialog(null);
    } catch (err) {
      setError(getQueryErrorMessage(err));
    }
  };

  const issued = rx && rx.status !== 'draft';
  return (
    <SectionCard
      title="Prescription"
      icon={Pill}
      iconTone="primary"
      actions={
        issued ? (
          <div className="flex flex-wrap gap-2">
            <Link to={`/print/prescriptions/${rx.id}`} className={buttonClass('secondary', 'sm')}>
              <Printer className="h-4 w-4" aria-hidden="true" /> Print
            </Link>
            {canChange && rx.status === 'issued' && (
              <>
                <Button variant="secondary" size="sm" onClick={() => setDialog('reissue')}>
                  <RefreshCcw className="h-4 w-4" aria-hidden="true" /> Reissue
                </Button>
                <Button variant="softDanger" size="sm" onClick={() => setDialog('cancel')}>
                  <Ban className="h-4 w-4" aria-hidden="true" /> Cancel
                </Button>
              </>
            )}
          </div>
        ) : undefined
      }
    >
      {current.isLoading && <ListSkeleton label="Loading prescription…" rows={2} />}
      {current.isError && <ErrorState error={current.error} onRetry={current.refetch} />}
      {!current.isLoading && !current.isError && !rx && (
        <EmptyState icon={Pill} title="No current prescription" />
      )}
      {error && !dialog && (
        <div className="mb-3">
          <Alert tone="error" title={error}>
            {issueProblems.length > 0 && (
              <ul className="list-disc pl-5">
                {issueProblems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
          </Alert>
        </div>
      )}
      {issued && (
        <div className="space-y-3">
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
            <StatusPill domain="prescription" status={rx.status} size="sm" />
            <span className="tabular">{rx.prescriptionNumber}</span>
          </p>
          <PrescriptionItems prescription={rx} />
        </div>
      )}
      {rx?.status === 'draft' && canChange && (
        <div className="space-y-4">
          <Alert tone="info" title="New prescription (not issued yet)">
            It replaces the cancelled prescription. Edit it, then issue it.
          </Alert>
          <PrescriptionEditor draft={draft} server={rx} />
          <Button onClick={() => void onIssue()} loading={issuing.isLoading}>
            <FileCheck2 className="h-4 w-4" aria-hidden="true" /> Issue prescription
          </Button>
        </div>
      )}
      <ReasonDialog
        open={dialog === 'cancel'}
        title="Cancel prescription"
        label="Reason for cancelling"
        confirmLabel="Cancel prescription"
        tone="danger"
        minLength={PRESCRIPTION_REASON_MIN}
        loading={cancelling.isLoading}
        error={dialog ? error : null}
        onCancel={() => setDialog(null)}
        onSubmit={(reason) => void withReason('cancel', reason)}
      >
        The patient will no longer see this prescription as current. This cannot be undone.
      </ReasonDialog>
      <ReasonDialog
        open={dialog === 'reissue'}
        title="Reissue prescription"
        label="Reason for the change"
        confirmLabel="Cancel and create new draft"
        minLength={PRESCRIPTION_REASON_MIN}
        loading={reissuing.isLoading}
        error={dialog ? error : null}
        onCancel={() => setDialog(null)}
        onSubmit={(reason) => void withReason('reissue', reason)}
      >
        The current prescription is cancelled and a new draft with the same drugs opens here for you
        to change and issue.
      </ReasonDialog>
      {leaveGuard}
    </SectionCard>
  );
}
