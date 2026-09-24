import { Ticket } from 'lucide-react';
import { useQueueRooms } from '../../../hooks/useSocketInvalidation';
import SectionCard from '../../../components/ui/SectionCard';
import { clinicDate } from '../../../utils/dates';
import { useMyPositionQuery } from '../api';

/**
 * "Your token" on the patient dashboard (spec §4.6, §7.9 my-position): shown only while the
 * patient is checked in today. Refreshed by the socket (queue.updated for their doctor) and every
 * 30 s as a fallback.
 */
export default function MyTokenCard() {
  const { data } = useMyPositionQuery(undefined, { pollingInterval: 30_000 });
  useQueueRooms(data ? [{ doctorId: data.doctor.id, date: clinicDate() }] : []);
  if (!data) return null;

  const withDoctor = data.status === 'in_consultation';
  return (
    <SectionCard title="Your token" icon={Ticket} iconTone="warning">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <span
          className="tabular flex h-20 min-w-20 items-center justify-center rounded-card bg-warning-50 px-4 text-stat text-warning-700"
          aria-label={`Token ${data.tokenNumber ?? '–'}`}
        >
          {data.tokenNumber ?? '–'}
        </span>
        <div aria-live="polite">
          {withDoctor ? (
            <p className="text-card text-ink">Please go in – the doctor is seeing you now.</p>
          ) : data.patientsAhead === 0 ? (
            <p className="text-card text-ink">You are next.</p>
          ) : (
            <p className="text-card text-ink">
              {data.patientsAhead} {data.patientsAhead === 1 ? 'patient' : 'patients'} ahead of you
            </p>
          )}
          {!withDoctor && (
            <p className="tabular mt-1 text-sm text-muted">
              Estimated wait: about {data.estimatedWaitMinutes} min
            </p>
          )}
          <p className="mt-1 text-sm text-body">
            {data.doctor.name}
            {data.doctor.roomNumber ? ` · Room ${data.doctor.roomNumber}` : ''}
          </p>
        </div>
      </div>
    </SectionCard>
  );
}
