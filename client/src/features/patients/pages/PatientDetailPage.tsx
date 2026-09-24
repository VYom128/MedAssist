import { History, Send } from 'lucide-react';
import { useLocation, useParams, useSearchParams } from 'react-router-dom';
import { useAppSelector } from '../../../app/hooks';
import Alert from '../../../components/ui/Alert';
import BackLink from '../../../components/ui/BackLink';
import Card from '../../../components/ui/Card';
import EmptyState from '../../../components/ui/EmptyState';
import ErrorState from '../../../components/ui/ErrorState';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import Tabs from '../../../components/ui/Tabs';
import { ROLES } from '../../../constants/roles';
import { isApiQueryError } from '../../../utils/http';
import { selectCurrentUser } from '../../auth/authSlice';
import { useGetPatientQuery } from '../api';
import InviteButton from '../components/InviteButton';
import OverviewTab from '../components/OverviewTab';
import PatientHeader from '../components/PatientHeader';
import PatientStatusActions from '../components/PatientStatusActions';
import PortalAccessTab from '../components/PortalAccessTab';
import { patientsBase } from '../paths';
import { portalState } from '../portal';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'portal', label: 'Portal access' },
  { id: 'history', label: 'Appointments & history' },
];

/**
 * /reception/patients/:id and /admin/patients/:id. The server shapes the record per role
 * (spec §2.5): admins get no allergies and only view; reception edits and invites.
 */
export default function PatientDetailPage() {
  const { id = '' } = useParams();
  const user = useAppSelector(selectCurrentUser);
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const isReception = user?.role === ROLES.RECEPTIONIST;
  const isAdmin = user?.role === ROLES.ADMIN;
  const base = patientsBase(user?.role);
  const tab = TABS.some((t) => t.id === params.get('tab')) ? params.get('tab')! : 'overview';
  const { data: patient, isLoading, isError, error, refetch } = useGetPatientQuery(id);
  const offerInvite = (location.state as { offerInvite?: boolean } | null)?.offerInvite;

  const back = <BackLink to={base} label="Patients" />;

  if (isLoading) {
    return (
      <section className="mx-auto w-full max-w-5xl">
        {back}
        <ListSkeleton label="Loading patient…" rows={3} />
      </section>
    );
  }
  if (isError || !patient) {
    const notFound = isApiQueryError(error) && error.status === 404;
    return (
      <section className="mx-auto w-full max-w-5xl">
        {back}
        {notFound ? (
          <Alert tone="error">This patient record does not exist.</Alert>
        ) : (
          <ErrorState error={error} onRetry={() => void refetch()} />
        )}
      </section>
    );
  }

  const showInviteOffer =
    isReception && offerInvite && portalState(patient.portal, patient.hasPortal) === 'none';

  return (
    <section className="mx-auto w-full max-w-5xl">
      {back}
      <PatientHeader
        patient={patient}
        actions={isAdmin ? <PatientStatusActions patient={patient} /> : undefined}
      />
      {showInviteOffer && (
        <div className="mb-6 flex flex-col gap-3 rounded-card border border-primary-100 bg-primary-50 p-4 motion-safe:animate-fade-in sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2 text-sm text-primary-700">
            <Send className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            Invite {patient.firstName} to the patient portal to book appointments and see records
            online.
          </p>
          <InviteButton patient={patient} />
        </div>
      )}
      <Tabs
        label="Patient sections"
        tabs={TABS}
        value={tab}
        onChange={(next) => setParams({ tab: next }, { replace: true, state: location.state })}
      >
        {tab === 'overview' && (
          <OverviewTab
            patient={patient}
            basePath={base}
            canEdit={isReception}
            canEditAllergies={isReception}
          />
        )}
        {tab === 'portal' && <PortalAccessTab patient={patient} canInvite={isReception} />}
        {tab === 'history' && (
          <Card>
            <EmptyState
              icon={History}
              title="Appointments and history"
              description="Coming in Phases 4 and 8: appointments, visits and the patient timeline."
            />
          </Card>
        )}
      </Tabs>
    </section>
  );
}
