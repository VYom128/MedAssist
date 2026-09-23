import { Link } from 'react-router-dom';
import Card from '../../../components/ui/Card';
import { formatDateTime } from '../../../utils/dates';
import type { Patient } from '../api';
import { portalState, type PortalState } from '../portal';
import InviteButton from './InviteButton';
import PortalBadge from './PortalBadge';

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
    <Card title="Patient portal">
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <PortalBadge state={state} />
        </div>
        <p className="text-slate-600">{EXPLAIN[state]}</p>
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-slate-500">Login email</dt>
            <dd className="mt-0.5 font-medium break-all">{patient.portal?.email ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Last login</dt>
            <dd className="mt-0.5 font-medium">{formatDateTime(patient.portal?.lastLoginAt)}</dd>
          </div>
        </dl>
        {state === 'none' && canInvite && <InviteButton patient={patient} />}
        {state === 'pending' && canInvite && (
          <Link
            to="/reception/pending-links"
            className="font-medium text-brand-700 hover:underline"
          >
            Go to pending verifications
          </Link>
        )}
      </div>
    </Card>
  );
}
