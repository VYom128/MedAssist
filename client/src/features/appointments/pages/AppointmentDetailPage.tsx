import { useParams } from 'react-router-dom';
import { useAppSelector } from '../../../app/hooks';
import Card from '../../../components/ui/Card';
import ErrorState from '../../../components/ui/ErrorState';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import PageHeader from '../../../components/ui/PageHeader';
import { formatDateTime } from '../../../utils/dates';
import { selectCurrentUser } from '../../auth/authSlice';
import { useGetAppointmentQuery } from '../api';
import AppointmentDetails from '../components/AppointmentDetails';
import { appointmentsBase } from '../paths';

/** /reception|admin|doctor/appointments/:id – one appointment with the actions the role may take. */
export default function AppointmentDetailPage() {
  const { id = '' } = useParams();
  const user = useAppSelector(selectCurrentUser);
  const { data, isLoading, isError, error, refetch } = useGetAppointmentQuery(id);
  const base = appointmentsBase(user?.role);

  return (
    <section>
      <PageHeader
        back={{ to: base, label: 'Appointments' }}
        title={data ? `Appointment ${data.appointmentNumber}` : 'Appointment'}
        description={data ? `${formatDateTime(data.startAt)} · ${data.doctor.name}` : undefined}
      />
      {isLoading && <ListSkeleton label="Loading appointment…" rows={4} />}
      {isError && <ErrorState error={error} onRetry={() => void refetch()} />}
      {data && (
        <Card>
          <AppointmentDetails appointment={data} />
        </Card>
      )}
    </section>
  );
}
