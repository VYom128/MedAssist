import { Pill } from 'lucide-react';
import { Link } from 'react-router-dom';
import SectionCard from '../../../components/ui/SectionCard';
import { linkClass } from '../../../components/ui/linkClass';
import { formatDate } from '../../../utils/dates';
import { useListPrescriptionsQuery } from '../api';

/** Patient home: prescriptions still being taken (issued, not completed). Hidden when none. */
export default function ActivePrescriptionsCard() {
  const { data } = useListPrescriptionsQuery({ status: 'issued', limit: 3 });
  if (!data || data.items.length === 0) return null;
  return (
    <SectionCard
      title="Active prescriptions"
      icon={Pill}
      iconTone="primary"
      actions={
        <Link to="/patient/prescriptions" className={`text-sm ${linkClass}`}>
          All prescriptions
        </Link>
      }
    >
      <ul className="space-y-2">
        {data.items.map((p) => (
          <li key={p.id} className="text-sm">
            <Link to={`/patient/prescriptions/${p.id}`} className={linkClass}>
              {p.itemCount} medicine{p.itemCount === 1 ? '' : 's'} · Dr {p.doctor.name}
            </Link>
            {p.issuedAt && (
              <span className="tabular block text-muted">Issued {formatDate(p.issuedAt)}</span>
            )}
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
