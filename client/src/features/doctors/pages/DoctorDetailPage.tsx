import { DoorOpen, Mail } from 'lucide-react';
import { useParams, useSearchParams } from 'react-router-dom';
import BackLink from '../../../components/ui/BackLink';
import ErrorState from '../../../components/ui/ErrorState';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import RecordHeader from '../../../components/ui/RecordHeader';
import StatusBadge from '../../../components/ui/StatusBadge';
import StatusPill from '../../../components/ui/StatusPill';
import Tabs from '../../../components/ui/Tabs';
import { useGetDoctorQuery, type Doctor } from '../api';
import AdminProfileTab from '../components/AdminProfileTab';
import LeaveTab from '../components/LeaveTab';
import ScheduleTab from '../components/ScheduleTab';

const TABS = [
  { id: 'profile', label: 'Profile' },
  { id: 'schedule', label: 'Weekly schedule' },
  { id: 'leave', label: 'Leave' },
];

/** Name, practice and status of the doctor at the top of the page. */
function DoctorHeader({ doctor }: { doctor: Doctor }) {
  const practice = [doctor.specialization, doctor.department?.name].filter(Boolean).join(' · ');
  return (
    <RecordHeader
      name={doctor.name}
      title={`Dr ${doctor.name}`}
      meta={practice ? <span>{practice}</span> : undefined}
      pills={
        <>
          <StatusBadge active={doctor.isActive !== false} />
          <StatusPill
            domain="booking"
            status={doctor.isAcceptingAppointments ? 'accepting' : 'paused'}
          >
            {doctor.isAcceptingAppointments ? 'Accepting bookings' : 'Bookings paused'}
          </StatusPill>
          {doctor.roomNumber && (
            <span className="inline-flex items-center gap-1 text-sm text-muted">
              <DoorOpen className="h-4 w-4" aria-hidden="true" /> Room {doctor.roomNumber}
            </span>
          )}
          {doctor.email && (
            <span className="inline-flex min-w-0 items-center gap-1 text-sm break-all text-muted">
              <Mail className="h-4 w-4 shrink-0" aria-hidden="true" /> {doctor.email}
            </span>
          )}
        </>
      }
    />
  );
}

/** /admin/doctors/:id – profile, weekly schedule and leave (the tab is in the URL). */
export default function DoctorDetailPage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.id === params.get('tab')) ? params.get('tab')! : 'profile';
  const { data: doctor, isLoading, isError, error, refetch } = useGetDoctorQuery(id);

  return (
    <section className="mx-auto w-full max-w-5xl">
      <BackLink to="/admin/doctors" label="Doctors" />
      {isLoading && <ListSkeleton label="Loading doctor…" rows={3} />}
      {isError && <ErrorState error={error} onRetry={() => void refetch()} />}
      {doctor && (
        <>
          <DoctorHeader doctor={doctor} />
          <Tabs
            label="Doctor sections"
            tabs={TABS}
            value={tab}
            onChange={(next) => setParams({ tab: next }, { replace: true })}
          >
            {tab === 'profile' && <AdminProfileTab doctor={doctor} />}
            {tab === 'schedule' && <ScheduleTab doctorId={doctor.id} />}
            {tab === 'leave' && <LeaveTab doctorId={doctor.id} />}
          </Tabs>
        </>
      )}
    </section>
  );
}
