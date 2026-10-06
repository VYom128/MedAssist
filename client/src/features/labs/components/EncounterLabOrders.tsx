import { FlaskConical, Pencil, Plus, Send, Trash2, XCircle } from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import Button from '../../../components/ui/Button';
import ConfirmDialog from '../../../components/ui/ConfirmDialog';
import EmptyState from '../../../components/ui/EmptyState';
import ErrorState from '../../../components/ui/ErrorState';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import ReasonDialog from '../../../components/ui/ReasonDialog';
import StatusPill from '../../../components/ui/StatusPill';
import { LAB_RULES } from '../../../constants/catalog';
import { formatDateTime } from '../../../utils/dates';
import { getQueryErrorMessage } from '../../../utils/http';
import {
  useCancelLabOrderMutation,
  useCreateLabOrderMutation,
  useDiscardLabOrderMutation,
  useLazyGetLabOrderQuery,
  useListLabOrdersQuery,
  useUpdateLabOrderMutation,
  type LabOrderListItem,
} from '../api';
import { UrgentPill } from './LabBadges';
import LabOrderForm, { type LabOrderFormValues } from './LabOrderForm';

/** Placed orders the ordering doctor may still cancel (no sample held). */
const CANCELLABLE = ['ordered', 'sample_rejected'];

const toBody = (v: LabOrderFormValues) => ({
  testIds: v.tests.map((t) => t.id),
  priority: v.priority,
  clinicalNotes: v.clinicalNotes.trim() ? v.clinicalNotes.trim() : null,
});

function OrderCard({
  order,
  onEdit,
  onDiscard,
  onCancel,
}: {
  order: LabOrderListItem;
  onEdit?: () => void;
  onDiscard?: () => void;
  onCancel?: () => void;
}) {
  return (
    <li className="rounded-control border border-line p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-semibold text-ink">
            {order.orderNumber ?? 'Draft order'}
            <StatusPill domain="labOrder" status={order.status} size="sm" />
            <UrgentPill priority={order.priority} />
          </p>
          <p className="mt-1 text-sm text-ink">
            {order.tests.map((t) => `${t.name} (${t.code})`).join(', ')}
          </p>
          {order.orderedAt && (
            <p className="text-xs text-muted">Sent {formatDateTime(order.orderedAt)}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {onEdit && (
            <Button size="sm" variant="secondary" onClick={onEdit}>
              <Pencil className="h-4 w-4" aria-hidden="true" /> Edit
            </Button>
          )}
          {onDiscard && (
            <Button size="sm" variant="ghost" onClick={onDiscard}>
              <Trash2 className="h-4 w-4" aria-hidden="true" /> Discard
            </Button>
          )}
          {onCancel && (
            <Button size="sm" variant="ghost" onClick={onCancel}>
              <XCircle className="h-4 w-4" aria-hidden="true" /> Cancel order
            </Button>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * Lab orders of one consultation (spec §4.7, Phase 6 decisions). On a DRAFT note, orders are
 * drafts – editable and discardable – and go to the lab when the note is signed. On a signed
 * note inside the 72-hour documentation window (`canOrder`), "Order more tests" sends them to the
 * lab at once.
 */
export default function EncounterLabOrders({
  encounterId,
  noteStatus,
  canOrder,
}: {
  encounterId: string;
  noteStatus: 'draft' | 'signed' | 'amended';
  canOrder: boolean;
}) {
  const list = useListLabOrdersQuery({ encounter: encounterId, limit: 50 });
  const [create, creating] = useCreateLabOrderMutation();
  const [update, updating] = useUpdateLabOrderMutation();
  const [discard, discarding] = useDiscardLabOrderMutation();
  const [cancel, cancelling] = useCancelLabOrderMutation();
  const [loadOrder] = useLazyGetLabOrderQuery();
  const [form, setForm] = useState<{ editId?: string; initial?: LabOrderFormValues } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [toDiscard, setToDiscard] = useState<LabOrderListItem | null>(null);
  const [toCancel, setToCancel] = useState<LabOrderListItem | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const isDraftNote = noteStatus === 'draft';
  const orders = list.data?.items ?? [];
  const drafts = orders.filter((o) => o.status === 'draft');
  const placed = orders.filter((o) => o.status !== 'draft');

  const openForm = async (edit?: LabOrderListItem) => {
    setFormError(null);
    if (!edit) {
      setForm({});
      return;
    }
    try {
      const o = await loadOrder(edit.id).unwrap();
      setForm({
        editId: o.id,
        initial: {
          tests: o.items.map((i) => ({ id: i.testId, code: i.code, name: i.name })),
          priority: o.priority,
          clinicalNotes: o.clinicalNotes ?? '',
        },
      });
    } catch (err) {
      toast.error(getQueryErrorMessage(err));
    }
  };

  const save = async (values: LabOrderFormValues) => {
    try {
      if (form?.editId) {
        await update({ id: form.editId, body: toBody(values) }).unwrap();
        toast.success('Lab order updated');
      } else {
        const created = await create({ encounterId, ...toBody(values) }).unwrap();
        toast.success(
          created.status === 'draft'
            ? 'Lab order saved – it is sent when you sign the note'
            : `Lab order ${created.orderNumber ?? ''} sent to the lab`,
        );
      }
      setForm(null);
    } catch (err) {
      setFormError(getQueryErrorMessage(err));
    }
  };

  const addButton = (isDraftNote || canOrder) && (
    <Button size="sm" onClick={() => void openForm()}>
      {isDraftNote ? (
        <Plus className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Send className="h-4 w-4" aria-hidden="true" />
      )}
      {isDraftNote ? 'Add lab tests' : 'Order more tests'}
    </Button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {isDraftNote
            ? 'Tests ordered here are drafts until you sign the note; then they go to the lab.'
            : canOrder
              ? 'Tests ordered now go straight to the lab.'
              : 'More tests can be ordered up to 72 hours after the visit.'}
        </p>
        {addButton}
      </div>
      {list.isLoading && <ListSkeleton label="Loading lab orders…" rows={2} />}
      {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
      {list.data && orders.length === 0 && (
        <EmptyState
          icon={FlaskConical}
          title="No lab tests ordered"
          description={isDraftNote ? 'Add tests for the lab if the visit needs them.' : undefined}
        />
      )}
      {drafts.length > 0 && (
        <section aria-label="Draft lab orders" className="space-y-2">
          <h3 className="text-sm font-semibold text-ink">To be sent when you sign</h3>
          <ul className="space-y-2">
            {drafts.map((o) => (
              <OrderCard
                key={o.id}
                order={o}
                onEdit={() => void openForm(o)}
                onDiscard={() => setToDiscard(o)}
              />
            ))}
          </ul>
        </section>
      )}
      {placed.length > 0 && (
        <section aria-label="Lab orders sent" className="space-y-2">
          <h3 className="text-sm font-semibold text-ink">Sent to the lab</h3>
          <ul className="space-y-2">
            {placed.map((o) => (
              <OrderCard
                key={o.id}
                order={o}
                onCancel={
                  CANCELLABLE.includes(o.status)
                    ? () => {
                        setCancelError(null);
                        setToCancel(o);
                      }
                    : undefined
                }
              />
            ))}
          </ul>
        </section>
      )}
      {form && (
        <LabOrderForm
          open
          title={
            form.editId ? 'Edit lab order' : isDraftNote ? 'Add lab tests' : 'Order more tests'
          }
          initial={form.initial}
          submitLabel={isDraftNote || form.editId ? 'Save lab order' : 'Send to the lab'}
          note={
            isDraftNote
              ? 'Saved as a draft: it goes to the lab when you sign the note.'
              : 'The lab sees this order at once.'
          }
          saving={creating.isLoading || updating.isLoading}
          error={formError}
          onSubmit={(v) => void save(v)}
          onClose={() => setForm(null)}
        />
      )}
      <ConfirmDialog
        open={toDiscard !== null}
        title="Discard this draft lab order?"
        confirmLabel="Discard"
        tone="danger"
        loading={discarding.isLoading}
        onCancel={() => setToDiscard(null)}
        onConfirm={() =>
          void discard(toDiscard!.id)
            .unwrap()
            .then(() => {
              toast.success('Draft lab order discarded');
              setToDiscard(null);
            })
            .catch((err: unknown) => toast.error(getQueryErrorMessage(err)))
        }
      >
        {toDiscard?.tests.map((t) => t.name).join(', ')} will not be sent to the lab.
      </ConfirmDialog>
      <ReasonDialog
        open={toCancel !== null}
        title={`Cancel ${toCancel?.orderNumber ?? 'lab order'}?`}
        label="Reason"
        confirmLabel="Cancel order"
        tone="danger"
        minLength={LAB_RULES.reasonMin}
        loading={cancelling.isLoading}
        error={cancelError}
        onCancel={() => setToCancel(null)}
        onSubmit={(reason) =>
          void cancel({ id: toCancel!.id, reason })
            .unwrap()
            .then(() => {
              toast.success('Lab order cancelled');
              setToCancel(null);
            })
            .catch((err: unknown) => setCancelError(getQueryErrorMessage(err)))
        }
      >
        The lab will not process it. Possible only before a sample is collected.
      </ReasonDialog>
    </div>
  );
}
