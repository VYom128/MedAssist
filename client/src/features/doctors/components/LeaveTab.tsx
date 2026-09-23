import { CalendarOff, Plus } from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import Badge from '../../../components/ui/Badge';
import Button from '../../../components/ui/Button';
import Card from '../../../components/ui/Card';
import ConfirmDialog from '../../../components/ui/ConfirmDialog';
import EmptyState from '../../../components/ui/EmptyState';
import ErrorState from '../../../components/ui/ErrorState';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import { LEAVE_TYPE_LABELS } from '../../../constants/catalog';
import { addDaysToDate, clinicDate } from '../../../utils/dates';
import { getQueryErrorMessage } from '../../../utils/http';
import { useCancelLeaveMutation, useListLeavesQuery, type Leave } from '../api';
import { formatLeave } from '../leaveFormat';
import AddLeaveModal from './AddLeaveModal';

function LeaveList({ items, onCancel }: { items: Leave[]; onCancel?: (l: Leave) => void }) {
  return (
    <ul className="divide-y divide-slate-100">
      {items.map((l) => (
        <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
          <div className="min-w-0">
            <p className={`font-medium ${l.isCancelled ? 'text-slate-400 line-through' : ''}`}>
              {formatLeave(l)}
            </p>
            <p className="text-sm text-slate-500">
              <Badge tone={l.type === 'emergency' ? 'danger' : 'info'}>
                {LEAVE_TYPE_LABELS[l.type]}
              </Badge>{' '}
              {l.reason}
              {l.isCancelled && <Badge tone="neutral">Cancelled</Badge>}
            </p>
          </div>
          {onCancel && !l.isCancelled && new Date(l.endAt) > new Date() && (
            <Button
              variant="ghost"
              className="!px-2 !py-1"
              onClick={() => onCancel(l)}
              aria-label={`Cancel leave ${formatLeave(l)}`}
            >
              Cancel leave
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * A doctor's leave (spec §4.13): upcoming (incl. current) and the last 12 months, add and
 * cancel. Used by admins and by doctors for themselves.
 */
export default function LeaveTab({ doctorId }: { doctorId: string }) {
  const today = clinicDate();
  const upcoming = useListLeavesQuery({
    id: doctorId,
    params: { from: today, includeCancelled: true, limit: 100 },
  });
  const past = useListLeavesQuery({
    id: doctorId,
    params: {
      from: addDaysToDate(today, -365),
      to: addDaysToDate(today, -1),
      includeCancelled: true,
      limit: 100,
    },
  });
  const [adding, setAdding] = useState(false);
  const [cancelling, setCancelling] = useState<Leave | null>(null);
  const [cancelLeave, { isLoading: busy }] = useCancelLeaveMutation();
  const [cancelError, setCancelError] = useState<string | null>(null);

  // A leave that started before today but is still running shows in both lists: keep it upcoming.
  const upcomingIds = new Set(upcoming.data?.items.map((l) => l.id));
  const pastItems = (past.data?.items ?? []).filter((l) => !upcomingIds.has(l.id)).reverse();

  const confirmCancel = async () => {
    if (!cancelling) return;
    try {
      await cancelLeave({ id: doctorId, leaveId: cancelling.id }).unwrap();
      toast.success('Leave cancelled');
      setCancelling(null);
      setCancelError(null);
    } catch (err) {
      setCancelError(getQueryErrorMessage(err));
    }
  };

  return (
    <div className="space-y-6">
      <Card
        title="Upcoming leave"
        actions={
          <Button onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" /> Add leave
          </Button>
        }
      >
        {upcoming.isLoading && <ListSkeleton label="Loading leave…" rows={2} />}
        {upcoming.isError && (
          <ErrorState error={upcoming.error} onRetry={() => void upcoming.refetch()} />
        )}
        {upcoming.data && upcoming.data.items.length === 0 && (
          <EmptyState
            icon={CalendarOff}
            title="No upcoming leave"
            action={
              <Button variant="secondary" onClick={() => setAdding(true)}>
                Add leave
              </Button>
            }
          />
        )}
        {upcoming.data && upcoming.data.items.length > 0 && (
          <LeaveList items={upcoming.data.items} onCancel={setCancelling} />
        )}
      </Card>

      <Card title="Past leave (last 12 months)">
        {past.isLoading && <ListSkeleton label="Loading past leave…" rows={2} />}
        {past.isError && <ErrorState error={past.error} onRetry={() => void past.refetch()} />}
        {past.data && pastItems.length === 0 && (
          <p className="text-sm text-slate-500">No past leave.</p>
        )}
        {pastItems.length > 0 && <LeaveList items={pastItems} />}
      </Card>

      <AddLeaveModal doctorId={doctorId} open={adding} onClose={() => setAdding(false)} />
      <ConfirmDialog
        open={cancelling !== null}
        title="Cancel this leave?"
        confirmLabel="Cancel leave"
        tone="danger"
        loading={busy}
        onConfirm={() => void confirmCancel()}
        onCancel={() => {
          setCancelling(null);
          setCancelError(null);
        }}
      >
        {cancelError && <p className="mb-2 text-rose-700">{cancelError}</p>}
        {cancelling && (
          <p>
            {formatLeave(cancelling)} will be available for appointments again. This cannot be
            undone; add the leave again if needed.
          </p>
        )}
      </ConfirmDialog>
    </div>
  );
}
