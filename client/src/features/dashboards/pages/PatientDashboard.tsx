import { IdCard } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAppSelector } from '../../../app/hooks';
import { VERIFY_IDENTITY_PATH } from '../../../routes/home';
import Alert from '../../../components/ui/Alert';
import DescriptionList from '../../../components/ui/DescriptionList';
import PageHeader from '../../../components/ui/PageHeader';
import SectionCard from '../../../components/ui/SectionCard';
import Skeleton from '../../../components/ui/Skeleton';
import { selectCurrentUser } from '../../auth/authSlice';
import { useGetMyPatientQuery } from '../../patients/api';
import NextAppointmentCard from '../../appointments/components/NextAppointmentCard';
import MyTokenCard from '../../queue/components/MyTokenCard';
import { useGetPublicSettingsQuery } from '../../settings/api';
import DashboardPlaceholder, { TodayPill } from '../components/DashboardPlaceholder';
import { linkClass } from '../../../components/ui/linkClass';

const UPCOMING = ['Prescriptions and lab reports', 'Invoices', 'Follow-up requests'];

/** "My details" card: MRN and a link to the profile. */
function MyDetailsCard() {
  const { data: patient, isLoading, isError } = useGetMyPatientQuery();
  return (
    <SectionCard
      title="My details"
      icon={IdCard}
      actions={
        <Link to="/patient/profile" className={`text-sm ${linkClass}`}>
          View profile
        </Link>
      }
    >
      {isLoading && (
        <div role="status" className="grid gap-4 sm:grid-cols-2">
          <span className="sr-only">Loading…</span>
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      )}
      {isError && <p className="text-sm text-muted">Your details could not be loaded.</p>}
      {patient && (
        <DescriptionList
          items={[
            {
              label: 'Patient number (MRN)',
              value: <span className="tabular font-mono">{patient.mrn}</span>,
            },
            { label: 'Name', value: patient.fullName },
          ]}
        />
      )}
    </SectionCard>
  );
}

/**
 * Patient dashboard. While a self-signup waits for the ID check, only a banner is shown (no
 * record cards); once linked, "My details" shows the MRN.
 */
export default function PatientDashboard() {
  const user = useAppSelector(selectCurrentUser);
  const { data: clinic } = useGetPublicSettingsQuery();
  if (user?.patientLinkStatus === 'pending_verification') {
    return (
      <section>
        <PageHeader
          eyebrow="Patient dashboard"
          title={`Welcome, ${user.firstName}`}
          actions={<TodayPill />}
        />
        <Alert tone="warning" title="Please verify your identity at the clinic">
          <p>
            Show a photo ID at the reception desk to connect your records. Until then, your
            appointments and records are not shown here.
          </p>
          <Link
            to={VERIFY_IDENTITY_PATH}
            className="mt-2 inline-flex items-center gap-1 rounded font-semibold underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-warning-700"
          >
            <IdCard className="h-4 w-4" aria-hidden="true" /> What to bring
          </Link>
        </Alert>
      </section>
    );
  }
  return (
    <DashboardPlaceholder
      upcoming={UPCOMING}
      hideLinksTo={user?.patientId ? ['/patient/profile'] : []}
    >
      {user?.patientId && (
        <div className="space-y-4">
          <MyTokenCard />
          <div className="grid gap-4 lg:grid-cols-2">
            <NextAppointmentCard canBook={clinic?.appointment.allowPatientSelfBooking !== false} />
            <MyDetailsCard />
          </div>
        </div>
      )}
    </DashboardPlaceholder>
  );
}
