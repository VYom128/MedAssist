import { Receipt } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAppSelector } from '../../../app/hooks';
import StatusPill from '../../../components/ui/StatusPill';
import { buttonClass } from '../../../components/ui/buttonClass';
import { ROLES } from '../../../constants/roles';
import { formatINR } from '../../../utils/money';
import { selectCurrentUser } from '../../auth/authSlice';
import { useListInvoicesQuery } from '../api';
import { invoicesBase } from '../paths';

/**
 * Appointment details (reception, admin): the visit's invoices with their status, and "Bill
 * patient" while one is a draft. Nothing when the visit has no invoice yet.
 */
export default function AppointmentInvoices({ appointmentId }: { appointmentId: string }) {
  const user = useAppSelector(selectCurrentUser);
  const desk = user?.role === ROLES.RECEPTIONIST || user?.role === ROLES.ADMIN;
  const { data } = useListInvoicesQuery({ appointment: appointmentId, limit: 10 }, { skip: !desk });
  if (!desk || !data || data.items.length === 0) return null;
  const base = invoicesBase(user?.role);
  return (
    <ul className="space-y-2" aria-label="Invoices for this visit">
      {data.items.map((i) => (
        <li key={i.id} className="flex flex-wrap items-center gap-2 text-sm">
          <Receipt className="h-4 w-4 text-muted" aria-hidden="true" />
          <span className="font-medium text-ink">{i.invoiceNumber ?? 'Draft invoice'}</span>
          <StatusPill domain="invoice" status={i.status} size="sm" />
          <span className="tabular text-muted">{formatINR(i.totalPaise)}</span>
          <Link
            to={`${base}/${i.id}`}
            className={buttonClass(i.status === 'draft' ? 'primary' : 'secondary', 'sm')}
          >
            {i.status === 'draft' ? 'Bill patient' : 'View invoice'}
          </Link>
        </li>
      ))}
    </ul>
  );
}
