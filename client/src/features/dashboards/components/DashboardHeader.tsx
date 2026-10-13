import { CalendarDays } from 'lucide-react';
import type { ReactNode } from 'react';
import { useAppSelector } from '../../../app/hooks';
import PageHeader from '../../../components/ui/PageHeader';
import { ROLE_LABELS } from '../../../constants/roles';
import { clinicDate, formatInClinic } from '../../../utils/dates';
import { selectCurrentUser } from '../../auth/authSlice';
import { ROLE_DESCRIPTIONS } from '../quickLinks';

/** Today in the clinic timezone, e.g. "Thursday, 24 Sep 2026". */
export function TodayPill() {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-2 text-sm font-medium text-ink shadow-card">
      <CalendarDays className="h-4 w-4 text-primary-600" aria-hidden="true" />
      <time dateTime={clinicDate()}>{formatInClinic(new Date(), 'EEEE, dd MMM yyyy')}</time>
    </span>
  );
}

/** Greeting at the top of every role dashboard: role eyebrow, name, one line, today's date. */
export default function DashboardHeader({ actions }: { actions?: ReactNode }) {
  const user = useAppSelector(selectCurrentUser);
  if (!user) return null;
  return (
    <PageHeader
      eyebrow={`${ROLE_LABELS[user.role]} dashboard`}
      title={`Welcome, ${user.firstName}`}
      description={ROLE_DESCRIPTIONS[user.role]}
      actions={
        <>
          {actions}
          <TodayPill />
        </>
      }
    />
  );
}
