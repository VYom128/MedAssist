import { Printer } from 'lucide-react';
import { Link } from 'react-router-dom';
import { buttonClass } from '../../../components/ui/buttonClass';
import { useListPrescriptionsQuery } from '../api';

/**
 * Reception: "Print prescription" for a completed appointment whose current prescription is
 * issued (reception sees issued/completed prescriptions only, for printing – spec §2.4).
 */
export default function PrintPrescriptionLink({ appointmentId }: { appointmentId: string }) {
  const { data } = useListPrescriptionsQuery({ appointment: appointmentId, limit: 20 });
  const rx = data?.items.find((p) => p.isCurrent && p.status !== 'cancelled');
  if (!rx) return null;
  return (
    <Link to={`/print/prescriptions/${rx.id}`} className={buttonClass('secondary', 'sm')}>
      <Printer className="h-4 w-4" aria-hidden="true" /> Print prescription
    </Link>
  );
}
