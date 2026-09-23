import { UserSearch } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import Button from '../../../components/ui/Button';
import { formatCalendarDate } from '../../../utils/dates';
import { formatPhone } from '../../../utils/phone';
import type { DuplicateMatch } from '../api';
import ReasonDialog from './ReasonDialog';

const MATCHED_ON = {
  phone_dob: 'same phone and date of birth',
  name_dob: 'same name and date of birth',
};

/**
 * "Possible existing patient" (spec §4.3): the records that match, with "Open existing record" or
 * "This is a different person" (needs a reason; the save is then forced and audited).
 */
export default function DuplicatePanel({
  matches,
  basePath,
  overrideReason,
  saving = false,
  onDifferentPerson,
}: {
  matches: DuplicateMatch[];
  /** '/reception/patients' – where the existing records open. */
  basePath: string;
  /** Set once the user has confirmed a different person. */
  overrideReason: string | null;
  saving?: boolean;
  onDifferentPerson: (reason: string) => void;
}) {
  const [asking, setAsking] = useState(false);
  if (matches.length === 0) return null;

  return (
    <section
      aria-labelledby="duplicate-heading"
      className="rounded-xl border border-amber-300 bg-amber-50 p-4"
    >
      <h2 id="duplicate-heading" className="flex items-center gap-2 font-semibold text-amber-900">
        <UserSearch className="h-5 w-5" aria-hidden="true" /> Possible existing patient
      </h2>
      <p className="mt-1 text-sm text-amber-900">
        {matches.length === 1 ? 'A patient' : `${matches.length} patients`} with these details
        {matches.length === 1 ? ' is' : ' are'} already registered. Check before creating a new
        record.
      </p>
      <ul className="mt-3 space-y-2">
        {matches.map((m) => (
          <li
            key={m.id}
            className="flex flex-col gap-2 rounded-lg bg-white p-3 text-sm shadow-sm sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="font-medium text-slate-900">
                {m.fullName} <span className="text-slate-500">· {m.mrn}</span>
                {!m.isActive && <span className="ml-1 text-slate-500">(inactive)</span>}
              </p>
              <p className="text-slate-600">
                Born {formatCalendarDate(m.dateOfBirth)} · {formatPhone(m.phone)}
              </p>
              <p className="text-xs text-slate-500">
                Matched on {m.matchedOn.map((r) => MATCHED_ON[r]).join(' and ')}
              </p>
            </div>
            <Link
              to={`${basePath}/${m.id}`}
              className="inline-flex shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-brand-600"
            >
              Open existing record
              <span className="sr-only"> for {m.fullName}</span>
            </Link>
          </li>
        ))}
      </ul>
      {overrideReason ? (
        <p className="mt-3 text-sm text-amber-900">
          Marked as a different person: “{overrideReason}”.
        </p>
      ) : (
        <Button
          variant="secondary"
          className="mt-3"
          loading={saving}
          onClick={() => setAsking(true)}
        >
          This is a different person
        </Button>
      )}
      <ReasonDialog
        open={asking}
        title="A different person?"
        confirmLabel="Save as a new patient"
        minLength={10}
        label="Why is this a different person?"
        onCancel={() => setAsking(false)}
        onSubmit={(reason) => {
          setAsking(false);
          onDifferentPerson(reason);
        }}
      >
        For example: twins sharing a phone number, or a family member with the same name. A separate
        record will be created and your reason recorded.
      </ReasonDialog>
    </section>
  );
}
