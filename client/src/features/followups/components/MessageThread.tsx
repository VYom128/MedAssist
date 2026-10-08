import { Lock } from 'lucide-react';
import Avatar from '../../../components/ui/Avatar';
import { formatDateTime } from '../../../utils/dates';
import type { Followup, FollowupMessage } from '../api';

const ROLE_NAMES: Record<string, string> = {
  patient: 'Patient',
  doctor: 'Doctor',
  receptionist: 'Reception',
  admin: 'Admin',
};

interface Entry {
  key: string;
  name: string;
  role: string;
  text: string;
  at: string | null;
  internal: boolean;
}

/**
 * The thread of a request as chat bubbles: the patient's opening message, then the replies.
 * - `viewer="patient"`: the patient on the right, the clinic on the left; internal staff notes
 *   are never rendered, even if a response carried one.
 * - `viewer="staff"`: the clinic on the right, the patient on the left; internal notes are
 *   tinted and labelled "Internal – not visible to patient".
 */
export default function MessageThread({
  request,
  viewer,
}: {
  request: Followup;
  viewer: 'patient' | 'staff';
}) {
  const patientName = request.patient.fullName ?? 'Patient';
  const visible = (m: FollowupMessage) => viewer === 'staff' || m.visibility === 'all';
  const entries: Entry[] = [
    {
      key: 'request',
      name: viewer === 'patient' ? 'You' : patientName,
      role: 'patient',
      text: request.message,
      at: request.createdAt,
      internal: false,
    },
    ...request.messages.filter(visible).map((m) => ({
      key: m.id,
      name: viewer === 'patient' && m.from.role === 'patient' ? 'You' : (m.from.name ?? 'Clinic'),
      role: m.from.role,
      text: m.text,
      at: m.at,
      internal: m.visibility === 'staff',
    })),
  ];

  return (
    <ol aria-label="Messages" className="space-y-4">
      {entries.map((e) => {
        const fromPatient = e.role === 'patient';
        const mine = viewer === 'patient' ? fromPatient : !fromPatient;
        const bubble = e.internal
          ? 'border border-dashed border-warning-500 bg-warning-50 text-ink'
          : mine
            ? 'bg-primary-600 text-white'
            : 'border border-line bg-surface-muted text-body';
        return (
          <li key={e.key} className={`flex gap-2.5 ${mine ? 'flex-row-reverse' : ''}`}>
            <Avatar name={e.name} size="sm" />
            <div
              className={`flex max-w-[85%] min-w-0 flex-col sm:max-w-[75%] ${mine ? 'items-end' : 'items-start'}`}
            >
              <p className="mb-1 text-xs text-muted">
                <span className="font-semibold text-ink">{e.name}</span>
                {e.name !== 'You' && ` · ${ROLE_NAMES[e.role] ?? e.role}`}
                {e.at && (
                  <>
                    {' · '}
                    <time dateTime={e.at} className="tabular">
                      {formatDateTime(e.at)}
                    </time>
                  </>
                )}
              </p>
              <div
                className={`rounded-card px-4 py-2.5 text-sm break-words whitespace-pre-line ${bubble}`}
              >
                {e.internal && (
                  <p className="mb-1 flex items-center gap-1 text-xs font-semibold text-warning-700">
                    <Lock className="h-3.5 w-3.5" aria-hidden="true" /> Internal – not visible to
                    patient
                  </p>
                )}
                {e.text}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
