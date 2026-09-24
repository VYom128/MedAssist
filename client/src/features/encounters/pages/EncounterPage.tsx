import { skipToken } from '@reduxjs/toolkit/query';
import { Navigate, useParams } from 'react-router-dom';
import { useAppSelector } from '../../../app/hooks';
import ErrorState from '../../../components/ui/ErrorState';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import PageHeader from '../../../components/ui/PageHeader';
import { formatDate } from '../../../utils/dates';
import { useGetAppointmentQuery } from '../../appointments/api';
import { selectCurrentUser } from '../../auth/authSlice';
import { useGetPatientQuery } from '../../patients/api';
import { useGetEncounterQuery } from '../api';
import ConsultHeader from '../components/ConsultHeader';
import SignedNoteView from '../components/SignedNoteView';

/**
 * /doctor/encounters/:id – one note, read-only (signed/amended) with Amend for its doctor.
 * The doctor's own draft opens in the consult workspace instead.
 */
export default function EncounterPage() {
  const { id = '' } = useParams();
  const user = useAppSelector(selectCurrentUser);
  const { data, isLoading, isError, error, refetch } = useGetEncounterQuery(id);
  const patient = useGetPatientQuery(data?.patient.id ?? skipToken);
  const appointment = useGetAppointmentQuery(
    data && data.doctor.id === user?.id ? data.appointmentId : skipToken,
  );

  if (data?.status === 'draft' && data.doctor.id === user?.id) {
    return <Navigate to={`/doctor/consult/${data.appointmentId}`} replace />;
  }
  return (
    <section className="space-y-6">
      <PageHeader
        back={{ to: '/doctor/queue', label: 'My queue' }}
        title={data ? `Visit note ${data.encounterNumber}` : 'Visit note'}
        description={data ? `${formatDate(data.visitAt)} · Dr ${data.doctor.name}` : undefined}
      />
      {(isLoading || patient.isLoading) && <ListSkeleton label="Loading note…" rows={5} />}
      {isError && <ErrorState error={error} onRetry={() => void refetch()} />}
      {patient.isError && (
        <ErrorState error={patient.error} onRetry={() => void patient.refetch()} />
      )}
      {data && patient.data && (
        <>
          <ConsultHeader patient={patient.data} appointment={appointment.data} />
          <SignedNoteView encounter={data} canAmend={data.doctor.id === user?.id} />
        </>
      )}
    </section>
  );
}
