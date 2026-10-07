import { TestTubes } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import SectionCard from '../../../components/ui/SectionCard';
import { linkClass } from '../../../components/ui/linkClass';
import { formatDate } from '../../../utils/dates';
import { useListLabOrdersQuery } from '../api';

const RECENT_DAYS = 30;

/** Patient home: lab reports released in the last 30 days (hidden when none). */
export default function NewLabReportsCard() {
  const { data } = useListLabOrdersQuery({ page: 1, limit: 3 });
  // Fixed when the card mounts (render stays pure).
  const [since] = useState(() => Date.now() - RECENT_DAYS * 86_400_000);
  const recent = (data?.items ?? []).filter(
    (o) => o.releasedAt && new Date(o.releasedAt).getTime() >= since,
  );
  if (recent.length === 0) return null;
  return (
    <SectionCard
      title="New lab reports"
      icon={TestTubes}
      iconTone="info"
      actions={
        <Link to="/patient/lab-reports" className={`text-sm ${linkClass}`}>
          All reports
        </Link>
      }
    >
      <ul className="space-y-2">
        {recent.map((o) => (
          <li key={o.id} className="text-sm">
            <Link to={`/patient/lab-reports/${o.id}`} className={linkClass}>
              {o.tests.map((t) => t.name).join(', ')}
            </Link>
            <span className="tabular block text-muted">Released {formatDate(o.releasedAt!)}</span>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
