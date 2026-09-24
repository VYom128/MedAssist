import { Link } from 'react-router-dom';
import { Globe } from 'lucide-react';
import DescriptionList from '../../../components/ui/DescriptionList';
import SectionCard from '../../../components/ui/SectionCard';
import { formatDateTime } from '../../../utils/dates';
import type { Patient } from '../api';
import { portalState, type PortalState } from '../portal';
import InviteButton from './InviteButton';
import PortalBadge from './PortalBadge';
import { linkClass } from '../../../components/ui/linkClass';

const EXPLAIN: Record<PortalState, string> = {
  none: 'This patient has no portal account.',
  invited:
    'An invitation with a "set your password" link was emailed. It is valid for 72 hours; the account shows as active after the first login.',
  linked: 'The patient can log in to see their appointments and records.',
  pending:
    'The patient signed up online. Check their photo ID at the desk, then confirm the link under Pending verifications.',
};

/** Portal access tab (spec §4.3 step 5, §4.4): status, invite, last login. */
export default function PortalAccessTab({
  patient,
  canInvite,
}: {
  patient: Patient;
  canInvite: boolean;
}) {
  const state = portalState(patient.portal, patient.hasPortal);
  return (
    <SectionCard title="Patient portal" icon={Globe} actions={<PortalBadge state={state} />}>
      <div className="space-y-5 text-sm">
        <p className="text-muted">{EXPLAIN[state]}</p>
        <DescriptionList
          items={[
            { label: 'Login email', value: patient.portal?.email },
            { label: 'Last login', value: formatDateTime(patient.portal?.lastLoginAt) },
          ]}
        />
        {state === 'none' && canInvite && <InviteButton patient={patient} />}
        {state === 'pending' && canInvite && (
          <Link to="/reception/pending-links" className={linkClass}>
            Go to pending verifications
          </Link>
        )}
      </div>
    </SectionCard>
  );
}
