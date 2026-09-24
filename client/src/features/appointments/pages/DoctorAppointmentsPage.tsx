import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAppSelector } from '../../../app/hooks';
import ErrorState from '../../../components/ui/ErrorState';
import FilterChip from '../../../components/ui/FilterChip';
import PageHeader from '../../../components/ui/PageHeader';
import Skeleton from '../../../components/ui/Skeleton';
import { useQueueRooms } from '../../../hooks/useSocketInvalidation';
import { useMediaQuery } from '../../../layouts/useSidebarCollapsed';
import { clinicDate } from '../../../utils/dates';
import { selectCurrentUser } from '../../auth/authSlice';
import { useGetCalendarQuery } from '../api';
import { calendarRange } from '../calendarRange';
import AppointmentCalendar from '../components/AppointmentCalendar';
import AppointmentDrawer from '../components/AppointmentDrawer';
import AppointmentList from '../components/AppointmentList';
import CalendarToolbar from '../components/CalendarToolbar';

/**
 * /doctor/appointments: the doctor's own calendar (read-only; start and complete from the
 * appointment) and list. /doctor/schedule stays the weekly availability editor.
 */
export default function DoctorAppointmentsPage() {
  const user = useAppSelector(selectCurrentUser);
  const [params, setParams] = useSearchParams();
  const isPhone = useMediaQuery('(max-width: 767px)');
  const view = params.get('view') ?? (isPhone ? 'list' : 'calendar');
  const mode: 'day' | 'week' = !isPhone && params.get('mode') === 'week' ? 'week' : 'day';
  const date = params.get('date') || clinicDate();
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
  const [openId, setOpenId] = useState<string | null>(null);
  const { from, to, days } = calendarRange(mode, date);
  const calendar = useGetCalendarQuery({ from, to }, { skip: view !== 'calendar' });
  useQueueRooms(
    view === 'calendar' && user ? days.map((day) => ({ doctorId: user.id, date: day })) : [],
  );

  return (
    <section>
      <PageHeader
        title="My appointments"
        description="Your own appointments. Your weekly hours are under My schedule."
      />
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="View">
        <FilterChip
          label="Calendar"
          selected={view === 'calendar'}
          onClick={() => set({ view: 'calendar' })}
        />
        <FilterChip label="List" selected={view === 'list'} onClick={() => set({ view: 'list' })} />
      </div>
      {view === 'list' && <AppointmentList base="/doctor/appointments" showDoctorFilters={false} />}
      {view === 'calendar' && (
        <div className="space-y-4">
          <CalendarToolbar
            mode={mode}
            date={date}
            allowWeek={!isPhone}
            onDate={(d) => set({ date: d })}
            onMode={(m) => set({ mode: m === 'week' ? 'week' : '' })}
          />
          {calendar.isLoading && <Skeleton className="h-[480px] w-full" />}
          {calendar.isError && (
            <ErrorState error={calendar.error} onRetry={() => void calendar.refetch()} />
          )}
          {calendar.data && user && (
            <>
              <AppointmentCalendar
                view={mode}
                date={date}
                events={calendar.data}
                doctors={[{ id: user.id, name: `${user.firstName} ${user.lastName}` }]}
                showResources={false}
                moving={null}
                readOnly
                onNavigate={(d) => set({ date: d })}
                onSelectEvent={setOpenId}
              />
              {calendar.data.length === 0 && (
                <p className="text-sm text-muted">No appointments in this range.</p>
              )}
            </>
          )}
        </div>
      )}
      <AppointmentDrawer appointmentId={openId} onClose={() => setOpenId(null)} />
    </section>
  );
}
