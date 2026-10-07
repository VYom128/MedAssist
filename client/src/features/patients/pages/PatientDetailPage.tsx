import { Send } from 'lucide-react';
import { useLocation, useParams, useSearchParams } from 'react-router-dom';
import { useAppSelector } from '../../../app/hooks';
import Alert from '../../../components/ui/Alert';
import BackLink from '../../../components/ui/BackLink';
import Card from '../../../components/ui/Card';
import ErrorState from '../../../components/ui/ErrorState';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import Tabs from '../../../components/ui/Tabs';
import { ROLES } from '../../../constants/roles';
import { isApiQueryError } from '../../../utils/http';
import { selectCurrentUser } from '../../auth/authSlice';
import PatientBillingPanel from '../../billing/components/PatientBillingPanel';
import DocumentsPanel from '../../documents/components/DocumentsPanel';
import PatientLabOrders from '../../labs/components/PatientLabOrders';
import Timeline from '../../timeline/components/Timeline';
import { TIMELINE_FILTERS } from '../../timeline/types';
import { useGetPatientQuery } from '../api';
import InviteButton from '../components/InviteButton';
import OverviewTab from '../components/OverviewTab';
import PatientHeader from '../components/PatientHeader';
import PatientStatusActions from '../components/PatientStatusActions';
import PortalAccessTab from '../components/PortalAccessTab';
import { patientsBase } from '../paths';
import { portalState } from '../portal';

const BASE_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'portal', label: 'Portal access' },
];
/**
 * Reception also has the timeline (non-clinical items only – the server leaves the rest out),
 * documents, billing and lab order statuses. Admins have no timeline (spec §8.8).
 */
const RECEPTION_TABS = [
  ...BASE_TABS,
  { id: 'timeline', label: 'Timeline' },
  { id: 'billing', label: 'Billing' },
  { id: 'documents', label: 'Documents' },
  { id: 'lab', label: 'Lab orders' },
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
  const TABS = isReception ? RECEPTION_TABS : BASE_TABS;
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
        {tab === 'billing' && isReception && (
          <PatientBillingPanel patientId={patient.id} base="/reception/invoices" />
        )}
        {tab === 'documents' && isReception && (
          <DocumentsPanel patientId={patient.id} title="Documents" />
        )}
        {tab === 'lab' && isReception && (
          <Card>
            <p className="mb-3 text-sm text-muted">
              Status only – results are for the doctor and the patient.
            </p>
            <PatientLabOrders patientId={patient.id} view="reception" />
          </Card>
        )}
        {tab === 'timeline' && isReception && (
          <Card>
            <Timeline patientId={patient.id} types={TIMELINE_FILTERS.receptionist} />
          </Card>
        )}
      </Tabs>
    </section>
  );
}
