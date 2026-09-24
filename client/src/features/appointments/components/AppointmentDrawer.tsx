import { ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAppSelector } from '../../../app/hooks';
import ErrorState from '../../../components/ui/ErrorState';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import Modal from '../../../components/ui/Modal';
import { linkClass } from '../../../components/ui/linkClass';
import { selectCurrentUser } from '../../auth/authSlice';
import { useGetAppointmentQuery } from '../api';
import { appointmentsBase } from '../paths';
import AppointmentDetails from './AppointmentDetails';

/** The appointment opened from the calendar, in a side drawer (bottom sheet on phones). */
export default function AppointmentDrawer({
  appointmentId,
  onClose,
}: {
  appointmentId: string | null;
  onClose: () => void;
}) {
  const user = useAppSelector(selectCurrentUser);
  const { data, isLoading, isError, error, refetch } = useGetAppointmentQuery(appointmentId ?? '', {
    skip: !appointmentId,
  });
  return (
    <Modal
      open={appointmentId !== null}
      title={data ? `Appointment ${data.appointmentNumber}` : 'Appointment'}
      variant="drawer"
      size="lg"
      onClose={onClose}
    >
      {isLoading && <ListSkeleton label="Loading appointment…" rows={4} />}
      {isError && <ErrorState error={error} onRetry={() => void refetch()} />}
      {data && (
        <>
          <AppointmentDetails appointment={data} />
          <Link
            to={`${appointmentsBase(user?.role)}/${data.id}`}
            className={`mt-5 inline-flex items-center gap-1 text-sm ${linkClass}`}
          >
            Open full page <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </>
      )}
    </Modal>
  );
}
