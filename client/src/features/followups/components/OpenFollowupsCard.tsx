import { MessageSquare } from 'lucide-react';
import { Link } from 'react-router-dom';
import SectionCard from '../../../components/ui/SectionCard';
import StatusPill from '../../../components/ui/StatusPill';
import { linkClass } from '../../../components/ui/linkClass';
import { OPEN_STATUSES, useListFollowupsQuery } from '../api';
import { FOLLOWUP_TYPE_LABELS } from '../labels';

/** Patient home: requests still waiting for the clinic or for the patient (hidden when none). */
export default function OpenFollowupsCard() {
  const { data } = useListFollowupsQuery({ status: OPEN_STATUSES.join(','), limit: 3 });
  if (!data || data.items.length === 0) return null;
  return (
    <SectionCard
      title="Open follow-up requests"
      icon={MessageSquare}
      iconTone="primary"
      actions={
        <Link to="/patient/follow-ups" className={`text-sm ${linkClass}`}>
          All requests
        </Link>
      }
    >
      <ul className="space-y-2">
        {data.items.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <Link to={`/patient/follow-ups/${r.id}`} className={linkClass}>
              {FOLLOWUP_TYPE_LABELS[r.type]?.label ?? r.type}
            </Link>
            <StatusPill domain="followup" status={r.status} size="sm" />
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
