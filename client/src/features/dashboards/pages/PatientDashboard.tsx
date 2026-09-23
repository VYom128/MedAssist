import { IdCard } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAppSelector } from '../../../app/hooks';
import { VERIFY_IDENTITY_PATH } from '../../../routes/home';
import Alert from '../../../components/ui/Alert';
import Card from '../../../components/ui/Card';
import { selectCurrentUser } from '../../auth/authSlice';
import { useGetMyPatientQuery } from '../../patients/api';
import DashboardPlaceholder from '../components/DashboardPlaceholder';

const UPCOMING = [
  'Book and manage appointments',
  'Prescriptions and lab reports',
  'Invoices',
  'Follow-up requests',
];

/** "My details" card: MRN and a link to the profile. */
function MyDetailsCard() {
  const { data: patient, isLoading, isError } = useGetMyPatientQuery();
  return (
    <Card
      title="My details"
      actions={
        <Link to="/patient/profile" className="text-sm font-medium text-brand-700 hover:underline">
          View profile
        </Link>
      }
    >
      {isLoading && <p className="text-sm text-slate-500">Loading…</p>}
      {isError && <p className="text-sm text-slate-500">Your details could not be loaded.</p>}
      {patient && (
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-500">Patient number (MRN)</dt>
            <dd className="font-mono font-medium">{patient.mrn}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Name</dt>
            <dd className="font-medium">{patient.fullName}</dd>
          </div>
        </dl>
      )}
    </Card>
  );
}

/**
 * Patient dashboard. While a self-signup waits for the ID check, only a banner is shown (no
 * record cards); once linked, "My details" shows the MRN.
 */
export default function PatientDashboard() {
  const user = useAppSelector(selectCurrentUser);
  if (user?.patientLinkStatus === 'pending_verification') {
    return (
      <section className="mx-auto w-full max-w-4xl space-y-4">
        <h1 className="text-2xl font-semibold">Welcome, {user.firstName}</h1>
        <Alert tone="warning" title="Please verify your identity at the clinic">
          <p>
            Show a photo ID at the reception desk to connect your records. Until then, your
            appointments and records are not shown here.
          </p>
          <Link
            to={VERIFY_IDENTITY_PATH}
            className="mt-2 inline-flex items-center gap-1 font-medium underline"
          >
            <IdCard className="h-4 w-4" aria-hidden="true" /> What to bring
          </Link>
        </Alert>
      </section>
    );
  }
  return (
    <DashboardPlaceholder upcoming={UPCOMING}>
      {user?.patientId && <MyDetailsCard />}
    </DashboardPlaceholder>
  );
}
