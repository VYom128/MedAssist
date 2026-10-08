import { CalendarPlus } from 'lucide-react';
import { Link } from 'react-router-dom';
import SectionCard from '../../../components/ui/SectionCard';
import { buttonClass } from '../../../components/ui/buttonClass';
import { formatCalendarDate } from '../../../utils/dates';
import { followUpBookingLink, useListFollowUpsDueQuery } from '../api';

/**
 * Patient home: follow-ups the doctor planned that are not booked yet (upcoming or up to 14 days
 * overdue), each with "Book follow-up" (doctor and visit prefilled). Hidden when none.
 */
export default function FollowUpDueCard() {
  const { data } = useListFollowUpsDueQuery();
  if (!data || data.length === 0) return null;
  return (
    <SectionCard title="Follow-up due" icon={CalendarPlus} iconTone="info">
      <ul className="divide-y divide-line">
        {data.map((due) => (
          <li
            key={due.encounterId}
            className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink">
                Dr {due.doctor.name}
                {due.department ? ` · ${due.department.name}` : ''}
              </p>
              <p className={`tabular text-sm ${due.overdue ? 'text-warning-700' : 'text-muted'}`}>
                {due.overdue ? 'Was due' : 'Due'} {formatCalendarDate(due.dueDate)}
              </p>
            </div>
            <Link to={followUpBookingLink(due)} className={buttonClass('primary', 'sm')}>
              Book follow-up
            </Link>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
