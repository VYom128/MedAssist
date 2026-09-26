import { skipToken } from '@reduxjs/toolkit/query';
import { BadgeCheck, FilePen, XCircle } from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import Alert from '../../../components/ui/Alert';
import Button from '../../../components/ui/Button';
import ErrorState from '../../../components/ui/ErrorState';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import Modal from '../../../components/ui/Modal';
import ReasonDialog from '../../../components/ui/ReasonDialog';
import StatusPill from '../../../components/ui/StatusPill';
import Textarea from '../../../components/ui/Textarea';
import { LAB_RULES } from '../../../constants/catalog';
import { formatDateTime } from '../../../utils/dates';
import { getQueryErrorMessage } from '../../../utils/http';
import { useGetLabTestQuery } from '../../labTests/api';
import {
  useCancelLabItemMutation,
  useReviseItemMutation,
  useSaveResultsMutation,
  useVerifyRevisionMutation,
  type LabItem,
  type LabOrder,
} from '../api';
import { canCancelItem, subjectOf } from '../format';
import ItemResultsForm from './ItemResultsForm';
import ResultsTable from './ResultsTable';

/** Revise released results: every value again, plus a reason (≥ 10 characters). */
function ReviseDialog({
  order,
  item,
  onClose,
}: {
  order: LabOrder;
  item: LabItem;
  onClose: () => void;
}) {
  const test = useGetLabTestQuery(item.testId);
  const [revise, revising] = useReviseItemMutation();
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | undefined>();
  return (
    <Modal open onClose={onClose} size="lg" title={`Revise ${item.name}`}>
      {test.isLoading && <ListSkeleton label="Loading the test…" rows={3} />}
      {test.isError && <ErrorState error={test.error} onRetry={() => void test.refetch()} />}
      {test.data && (
        <ItemResultsForm
          idPrefix={`revise-${item.id}`}
          parameters={test.data.parameters}
          results={item.results}
          remarks={item.remarks}
          subject={subjectOf(order)}
          submitLabel={
            order.requireDualVerification === false ? 'Save correction' : 'Submit for verification'
          }
          saving={revising.isLoading}
          requireAll
          extra={
            <Textarea
              label="Reason for the correction"
              hint={`At least ${LAB_RULES.revisionReasonMin} characters. Kept with the old version.`}
              error={reasonError}
              maxLength={LAB_RULES.reasonMax}
              rows={2}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setReasonError(undefined);
              }}
            />
          }
          onSubmit={async (results, remarks) => {
            if (reason.trim().length < LAB_RULES.revisionReasonMin) {
              setReasonError(`Give a reason of at least ${LAB_RULES.revisionReasonMin} characters`);
              return;
            }
            try {
              const updated = await revise({
                id: order.id,
                itemId: item.id,
                results,
                remarks,
                reason: reason.trim(),
              }).unwrap();
              const applied = updated.items.find((i) => i.id === item.id)?.pendingRevision == null;
              toast.success(
                applied
                  ? 'Correction released – the patient and doctor are notified'
                  : 'Correction saved – another lab technician must verify it',
              );
              onClose();
            } catch (err) {
              toast.error(getQueryErrorMessage(err));
              throw err;
            }
          }}
        />
      )}
    </Modal>
  );
}

/** A pending correction: released vs corrected values, and "Verify revision" for another tech. */
function PendingRevision({
  order,
  item,
  userId,
}: {
  order: LabOrder;
  item: LabItem;
  userId: string | undefined;
}) {
  const [verify, verifying] = useVerifyRevisionMutation();
  const pending = item.pendingRevision!;
  const own = order.requireDualVerification !== false && pending.by === userId;
  return (
    <Alert tone="warning" title="Correction waiting for verification">
      <div className="mt-2 grid gap-4 md:grid-cols-2">
        <div>
          <p className="mb-1 text-xs font-semibold text-muted uppercase">Released now</p>
          <ResultsTable results={item.results} caption={`${item.name} released results`} />
        </div>
        <div>
          <p className="mb-1 text-xs font-semibold text-muted uppercase">Correction</p>
          <ResultsTable results={pending.results} caption={`${item.name} corrected results`} />
        </div>
      </div>
      <p className="mt-2 text-sm">
        Reason: {pending.reason ?? '—'} · {formatDateTime(pending.at)}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          disabled={own}
          loading={verifying.isLoading}
          onClick={() =>
            void verify({ id: order.id, itemId: item.id })
              .unwrap()
              .then(() => toast.success('Correction verified and released'))
              .catch((err: unknown) => toast.error(getQueryErrorMessage(err)))
          }
        >
          <BadgeCheck className="h-4 w-4" aria-hidden="true" /> Verify revision
        </Button>
        {own && (
          <span className="text-sm">
            You made this correction – another lab technician has to verify it.
          </span>
        )}
      </div>
    </Alert>
  );
}

/** Results entry for one test while the order is processing. */
function EntryForm({ order, item }: { order: LabOrder; item: LabItem }) {
  const test = useGetLabTestQuery(item.testId ?? skipToken);
  const [save, saving] = useSaveResultsMutation();
  if (test.isLoading) return <ListSkeleton label="Loading parameters…" rows={2} />;
  if (test.isError || !test.data) {
    return <ErrorState error={test.error} onRetry={() => void test.refetch()} />;
  }
  return (
    <ItemResultsForm
      idPrefix={`item-${item.id}`}
      parameters={test.data.parameters}
      results={item.results}
      remarks={item.remarks}
      subject={subjectOf(order)}
      submitLabel={`Save ${item.code}`}
      saving={saving.isLoading}
      onSubmit={async (results, remarks) => {
        try {
          const updated = await save({ id: order.id, itemId: item.id, results, remarks }).unwrap();
          const saved = updated.items.find((i) => i.id === item.id);
          toast.success(
            saved?.status === 'result_entered'
              ? `${item.name}: results saved`
              : `${item.name}: saved (some parameters still empty)`,
          );
          if (updated.hasCritical) toast.error('Critical value – the ordering doctor was alerted');
        } catch (err) {
          toast.error(getQueryErrorMessage(err));
          throw err;
        }
      }}
    />
  );
}

/**
 * One test of an order in the lab: status, results (an entry form while processing), who entered
 * and verified them, earlier versions, "Revise result" after release, and "Cancel test" while it
 * has no results.
 */
export default function LabItemCard({
  order,
  item,
  userId,
}: {
  order: LabOrder;
  item: LabItem;
  userId: string | undefined;
}) {
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [revising, setRevising] = useState(false);
  const [cancelItem, cancel] = useCancelLabItemMutation();
  // The catalogue entry: parameters for entry and the patient preparation (cached per test).
  const test = useGetLabTestQuery(item.testId);
  const editable =
    order.status === 'processing' &&
    (item.status === 'pending' || item.status === 'result_entered');
  const released = order.status === 'released' && item.status === 'verified';

  return (
    <article aria-label={item.name} className="rounded-control border border-line p-4">
      <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-ink">
            {item.name} <span className="font-normal text-muted">({item.code})</span>
          </h3>
          <p className="text-xs text-muted">
            {item.sampleType ? `Sample: ${item.sampleType}` : ''}
            {item.turnaroundHours ? ` · TAT ${item.turnaroundHours} h` : ''}
            {item.resultVersion > 1 ? ` · version ${item.resultVersion}` : ''}
          </p>
          {test.data?.preparation && (
            <p className="text-xs text-muted">Preparation: {test.data.preparation}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill domain="labItem" status={item.status} size="sm" />
          {canCancelItem(order, item) && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setCancelError(null);
                setCancelling(true);
              }}
            >
              <XCircle className="h-4 w-4" aria-hidden="true" /> Cancel test
            </Button>
          )}
          {released && !item.pendingRevision && (
            <Button size="sm" variant="secondary" onClick={() => setRevising(true)}>
              <FilePen className="h-4 w-4" aria-hidden="true" /> Revise result
            </Button>
          )}
        </div>
      </header>

      {item.status === 'cancelled' ? (
        <p className="text-sm text-muted">
          Cancelled{item.cancellation?.reason ? `: ${item.cancellation.reason}` : ''}.
        </p>
      ) : editable ? (
        <EntryForm order={order} item={item} />
      ) : (
        <div className="space-y-2">
          <ResultsTable results={item.results} caption={`${item.name} results`} />
          {item.remarks && <p className="text-sm text-muted">Remarks: {item.remarks}</p>}
        </div>
      )}

      {(item.enteredBy || item.verifiedBy) && (
        <p className="mt-2 text-xs text-muted">
          {item.enteredBy
            ? `Entered by ${item.enteredBy.name ?? 'a lab technician'}${item.enteredAt ? ` on ${formatDateTime(item.enteredAt)}` : ''}`
            : ''}
          {item.verifiedBy
            ? ` · verified by ${item.verifiedBy.name ?? 'a lab technician'}${item.verifiedAt ? ` on ${formatDateTime(item.verifiedAt)}` : ''}`
            : ''}
        </p>
      )}

      {item.pendingRevision && (
        <div className="mt-3">
          <PendingRevision order={order} item={item} userId={userId} />
        </div>
      )}

      {item.previousResults.length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer font-semibold text-ink">
            Earlier versions ({item.previousResults.length})
          </summary>
          <div className="mt-2 space-y-3">
            {item.previousResults.map((v) => (
              <div key={v.version}>
                <p className="text-xs text-muted">
                  Version {v.version} · replaced {v.revisedAt ? formatDateTime(v.revisedAt) : ''}
                  {v.reason ? ` · ${v.reason}` : ''}
                </p>
                <ResultsTable results={v.results} caption={`${item.name} version ${v.version}`} />
              </div>
            ))}
          </div>
        </details>
      )}

      {revising && <ReviseDialog order={order} item={item} onClose={() => setRevising(false)} />}
      <ReasonDialog
        open={cancelling}
        title={`Cancel ${item.name}?`}
        label="Reason"
        confirmLabel="Cancel test"
        tone="danger"
        minLength={LAB_RULES.reasonMin}
        loading={cancel.isLoading}
        error={cancelError}
        onCancel={() => setCancelling(false)}
        onSubmit={(reason) =>
          void cancelItem({ id: order.id, itemId: item.id, reason })
            .unwrap()
            .then(() => {
              toast.success(`${item.name} cancelled`);
              setCancelling(false);
            })
            .catch((err: unknown) => setCancelError(getQueryErrorMessage(err)))
        }
      >
        E.g. &ldquo;Reagent unavailable&rdquo;. The ordering doctor sees the reason.
      </ReasonDialog>
    </article>
  );
}
