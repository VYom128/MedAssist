import { CalendarOff, History, Plus, X } from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import Button from '../../../components/ui/Button';
import ConfirmDialog from '../../../components/ui/ConfirmDialog';
import EmptyState from '../../../components/ui/EmptyState';
import ErrorState from '../../../components/ui/ErrorState';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import SectionCard from '../../../components/ui/SectionCard';
import StatusPill from '../../../components/ui/StatusPill';
import { addDaysToDate, clinicDate } from '../../../utils/dates';
import { getQueryErrorMessage } from '../../../utils/http';
import { useCancelLeaveMutation, useListLeavesQuery, type Leave } from '../api';
import { formatLeave } from '../leaveFormat';
import AddLeaveModal from './AddLeaveModal';

function LeaveList({ items, onCancel }: { items: Leave[]; onCancel?: (l: Leave) => void }) {
  return (
    <ul className="grid gap-3 md:grid-cols-2">
      {items.map((l) => (
        <li
          key={l.id}
          className={`flex flex-col gap-3 rounded-control border p-4 ${
            l.isCancelled ? 'border-dashed border-line-strong' : 'border-line bg-surface-muted'
          }`}
        >
          <div className="min-w-0">
            <p
              className={`tabular font-semibold ${l.isCancelled ? 'text-muted line-through' : 'text-ink'}`}
            >
              {formatLeave(l)}
            </p>
            {l.reason && <p className="mt-0.5 text-sm text-muted">{l.reason}</p>}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1.5">
              <StatusPill domain="leave" status={l.type} />
              {l.isCancelled && <StatusPill domain="leave" status="cancelled" />}
            </div>
            {onCancel && !l.isCancelled && new Date(l.endAt) > new Date() && (
              <Button
                variant="ghost"
                size="sm"
                className="hover:text-danger-700"
                onClick={() => onCancel(l)}
                aria-label={`Cancel leave ${formatLeave(l)}`}
              >
                <X className="h-4 w-4" aria-hidden="true" /> Cancel leave
              </Button>
            )}
          </div>
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
      <SectionCard
        title="Upcoming leave"
        description="Includes leave that is happening now."
        icon={CalendarOff}
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
      </SectionCard>

      <SectionCard title="Past leave (last 12 months)" icon={History} iconTone="neutral">
        {past.isLoading && <ListSkeleton label="Loading past leave…" rows={2} />}
        {past.isError && <ErrorState error={past.error} onRetry={() => void past.refetch()} />}
        {past.data && pastItems.length === 0 && (
          <p className="text-sm text-muted">No past leave.</p>
        )}
        {pastItems.length > 0 && <LeaveList items={pastItems} />}
      </SectionCard>

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
        {cancelError && <p className="mb-2 text-danger-700">{cancelError}</p>}
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
