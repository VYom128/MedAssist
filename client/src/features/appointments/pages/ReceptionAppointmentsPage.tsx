import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { useSearchParams } from 'react-router-dom';
import Button from '../../../components/ui/Button';
import ErrorState from '../../../components/ui/ErrorState';
import FilterChip from '../../../components/ui/FilterChip';
import PageHeader from '../../../components/ui/PageHeader';
import ReasonDialog from '../../../components/ui/ReasonDialog';
import Select from '../../../components/ui/Select';
import Skeleton from '../../../components/ui/Skeleton';
import { APPOINTMENT_REASON_MIN } from '../../../constants/catalog';
import { useQueueRooms } from '../../../hooks/useSocketInvalidation';
import { useMediaQuery } from '../../../layouts/useSidebarCollapsed';
import {
  addDaysToDate,
  clinicDate,
  formatCalendarDate,
  formatDateTime,
} from '../../../utils/dates';
import { getQueryErrorMessage } from '../../../utils/http';
import { useListDoctorsQuery } from '../../doctors/api';
import { useGetCalendarQuery, useRescheduleAppointmentMutation, type CalendarEvent } from '../api';
import AppointmentCalendar from '../components/AppointmentCalendar';
import AppointmentDrawer from '../components/AppointmentDrawer';
import AppointmentList from '../components/AppointmentList';
import BookingModal, { type BookingPrefill } from '../components/BookingModal';

/** Monday of the week containing `date` ('YYYY-MM-DD'). */
const mondayOf = (date: string) => {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return addDaysToDate(date, -((weekday + 6) % 7));
};

interface PendingMove {
  event: CalendarEvent;
  startAt: string;
  doctorId?: string;
}

/**
 * /reception/appointments (spec §13.4 #1): a calendar (day/week, all doctors as columns in day
 * view, drag to reschedule, click to book or open) and a filterable list. The view, date,
 * calendar mode and doctor are in the URL. Phones default to the list; the calendar there is day
 * view only.
 */
export default function ReceptionAppointmentsPage() {
  const [params, setParams] = useSearchParams();
  const isPhone = useMediaQuery('(max-width: 767px)');
  const view = params.get('view') ?? (isPhone ? 'list' : 'calendar');
  const mode: 'day' | 'week' = isPhone ? 'day' : params.get('mode') === 'week' ? 'week' : 'day';
  const date = params.get('date') || clinicDate();
  const doctorId = params.get('doctor') ?? '';
  const set = (changes: Record<string, string>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(changes)) {
          if (v) next.set(k, v);
          else next.delete(k);
        }
        return next;
      },
      { replace: true },
    );

  const [booking, setBookingState] = useState<BookingPrefill | null>(null);
  /** A new key per booking, so the form starts from its prefill. */
  const [bookingKey, setBookingKey] = useState(0);
  const setBooking = (prefill: BookingPrefill | null) => {
    if (prefill) setBookingKey((n) => n + 1);
    setBookingState(prefill);
  };
  const [openId, setOpenId] = useState<string | null>(null);
  const [move, setMove] = useState<PendingMove | null>(null);
  const [reschedule, rescheduling] = useRescheduleAppointmentMutation();

  const from = mode === 'week' ? mondayOf(date) : date;
  const to = mode === 'week' ? addDaysToDate(from, 6) : date;
  const doctors = useListDoctorsQuery({ limit: 100 });
  const calendar = useGetCalendarQuery(
    { from, to, ...(doctorId ? { doctor: doctorId } : {}) },
    { skip: view !== 'calendar' },
  );
  const doctorList = useMemo(
    () => (doctors.data?.items ?? []).map((d) => ({ id: d.id, name: d.name })),
    [doctors.data],
  );
  const shown = doctorId ? doctorList.filter((d) => d.id === doctorId) : doctorList;

  // Live updates for the doctors and days on screen.
  const rooms = useMemo(() => {
    if (view !== 'calendar') return [];
    const days =
      mode === 'week' ? Array.from({ length: 7 }, (_, i) => addDaysToDate(from, i)) : [from];
    return shown.flatMap((d) => days.map((day) => ({ doctorId: d.id, date: day })));
  }, [view, mode, from, shown]);
  useQueueRooms(rooms);

  const step = mode === 'week' ? 7 : 1;
  const rangeLabel =
    mode === 'week'
      ? `${formatCalendarDate(from)} – ${formatCalendarDate(to)}`
      : formatCalendarDate(date);

  const confirmMove = async (reason: string) => {
    if (!move) return;
    try {
      const moved = await reschedule({
        id: move.event.id,
        body: {
          startAt: move.startAt,
          reason,
          ...(move.doctorId ? { doctorId: move.doctorId } : {}),
        },
      }).unwrap();
      toast.success(`${moved.appointmentNumber} moved to ${formatDateTime(moved.startAt)}`);
      setMove(null);
    } catch (err) {
      // The event goes back to where it was; the message says why.
      toast.error(getQueryErrorMessage(err));
      setMove(null);
    }
  };

  return (
    <section>
      <PageHeader
        title="Appointments"
        description="Book, move and follow today's and upcoming appointments."
        actions={
          <Button onClick={() => setBooking({ date })}>
            <Plus className="h-4 w-4" aria-hidden="true" /> Book appointment
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="View">
        <FilterChip
          label="Calendar"
          selected={view === 'calendar'}
          onClick={() => set({ view: 'calendar' })}
        />
        <FilterChip label="List" selected={view === 'list'} onClick={() => set({ view: 'list' })} />
        {isPhone && view === 'calendar' && (
          <p className="text-xs text-muted">Tip: the list is easier to use on a phone.</p>
        )}
      </div>

      {view === 'list' && <AppointmentList base="/reception/appointments" />}

      {view === 'calendar' && (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-card lg:flex-row lg:items-end lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                aria-label={mode === 'week' ? 'Previous week' : 'Previous day'}
                onClick={() => set({ date: addDaysToDate(date, -step) })}
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button variant="secondary" size="sm" onClick={() => set({ date: '' })}>
                Today
              </Button>
              <Button
                variant="secondary"
                size="sm"
                aria-label={mode === 'week' ? 'Next week' : 'Next day'}
                onClick={() => set({ date: addDaysToDate(date, step) })}
              >
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Button>
              <h2 className="tabular text-card" aria-live="polite">
                {rangeLabel}
              </h2>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              {!isPhone && (
                <div className="flex gap-2" role="group" aria-label="Calendar range">
                  <FilterChip
                    label="Day"
                    selected={mode === 'day'}
                    onClick={() => set({ mode: '' })}
                  />
                  <FilterChip
                    label="Week"
                    selected={mode === 'week'}
                    onClick={() => set({ mode: 'week' })}
                  />
                </div>
              )}
              <Select
                label="Doctor"
                placeholder="All doctors"
                className="min-w-56"
                options={doctorList.map((d) => ({ value: d.id, label: d.name }))}
                value={doctorId}
                onChange={(e) => set({ doctor: e.target.value })}
              />
            </div>
          </div>

          {mode === 'week' && !doctorId && (
            <p className="flex items-center gap-2 text-sm text-muted">
              <CalendarDays className="h-4 w-4" aria-hidden="true" /> Showing all doctors. Choose a
              doctor, or use the day view for one column per doctor.
            </p>
          )}
          {calendar.isLoading && <Skeleton className="h-[480px] w-full" />}
          {calendar.isError && (
            <ErrorState error={calendar.error} onRetry={() => void calendar.refetch()} />
          )}
          {calendar.data && (
            <div aria-busy={calendar.isFetching || undefined}>
              <AppointmentCalendar
                view={mode}
                date={date}
                events={calendar.data}
                doctors={shown}
                showResources={mode === 'day' && !doctorId && shown.length > 0}
                moving={
                  move
                    ? { id: move.event.id, startAt: move.startAt, doctorId: move.doctorId }
                    : null
                }
                onNavigate={(d) => set({ date: d })}
                onSelectEvent={setOpenId}
                onSelectSlot={(slot) =>
                  setBooking({
                    date: slot.date,
                    startAt: slot.startAt,
                    doctorId: slot.doctorId ?? (doctorId || undefined),
                  })
                }
                onMove={(event, startAt, newDoctor) =>
                  setMove({ event, startAt, doctorId: newDoctor })
                }
              />
              {calendar.data.length === 0 && (
                <p className="mt-3 text-sm text-muted">
                  No appointments in this range. Click an empty time to book one.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      <BookingModal
        key={bookingKey}
        open={booking !== null}
        prefill={booking ?? undefined}
        onClose={() => setBooking(null)}
      />
      <AppointmentDrawer appointmentId={openId} onClose={() => setOpenId(null)} />
      <ReasonDialog
        open={move !== null}
        title="Move appointment"
        label="Reason for moving"
        confirmLabel="Move appointment"
        minLength={APPOINTMENT_REASON_MIN}
        loading={rescheduling.isLoading}
        onCancel={() => setMove(null)}
        onSubmit={(reason) => void confirmMove(reason)}
      >
        {move && (
          <>
            Move {move.event.appointmentNumber} ({move.event.patientShortName}) to{' '}
            <span className="font-medium text-ink">{formatDateTime(move.startAt)}</span>
            {move.doctorId && (
              <>
                {' '}
                with{' '}
                <span className="font-medium text-ink">
                  {doctorList.find((d) => d.id === move.doctorId)?.name ?? 'another doctor'}
                </span>
              </>
            )}
            ? The patient is emailed.
          </>
        )}
      </ReasonDialog>
    </section>
  );
}
