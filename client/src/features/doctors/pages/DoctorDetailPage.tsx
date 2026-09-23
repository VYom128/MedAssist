import { ArrowLeft } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import PageHeader from '../../../components/PageHeader';
import Badge from '../../../components/ui/Badge';
import ErrorState from '../../../components/ui/ErrorState';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import StatusBadge from '../../../components/ui/StatusBadge';
import Tabs from '../../../components/ui/Tabs';
import { useGetDoctorQuery } from '../api';
import AdminProfileTab from '../components/AdminProfileTab';
import LeaveTab from '../components/LeaveTab';
import ScheduleTab from '../components/ScheduleTab';

const TABS = [
  { id: 'profile', label: 'Profile' },
  { id: 'schedule', label: 'Weekly schedule' },
  { id: 'leave', label: 'Leave' },
];

/** /admin/doctors/:id – profile, weekly schedule and leave (the tab is in the URL). */
export default function DoctorDetailPage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.id === params.get('tab')) ? params.get('tab')! : 'profile';
  const { data: doctor, isLoading, isError, error, refetch } = useGetDoctorQuery(id);

  return (
    <section className="mx-auto w-full max-w-5xl">
      <Link
        to="/admin/doctors"
        className="mb-3 inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Doctors
      </Link>
      {isLoading && <ListSkeleton label="Loading doctor…" rows={3} />}
      {isError && <ErrorState error={error} onRetry={() => void refetch()} />}
      {doctor && (
        <>
          <PageHeader
            title={`Dr ${doctor.name}`}
            description={[doctor.specialization, doctor.department?.name]
              .filter(Boolean)
              .join(' · ')}
            actions={
              <div className="flex items-center gap-2">
                <StatusBadge active={doctor.isActive !== false} />
                {!doctor.isAcceptingAppointments && <Badge tone="warning">Bookings paused</Badge>}
              </div>
            }
          />
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
