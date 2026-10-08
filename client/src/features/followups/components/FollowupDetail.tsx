import {
  CalendarCheck,
  CircleCheck,
  Eye,
  FileText,
  History,
  MessageSquare,
  Paperclip,
  UserRoundCog,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { Link } from 'react-router-dom';
import Alert from '../../../components/ui/Alert';
import Button from '../../../components/ui/Button';
import ConfirmDialog from '../../../components/ui/ConfirmDialog';
import DescriptionList from '../../../components/ui/DescriptionList';
import ErrorState from '../../../components/ui/ErrorState';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import ReasonDialog from '../../../components/ui/ReasonDialog';
import SectionCard from '../../../components/ui/SectionCard';
import StatusPill from '../../../components/ui/StatusPill';
import { buttonClass } from '../../../components/ui/buttonClass';
import { linkClass } from '../../../components/ui/linkClass';
import type { Role } from '../../../constants/roles';
import { useDownload } from '../../../hooks/useFileTransfer';
import { formatCalendarDate, formatDateTime } from '../../../utils/dates';
import { getQueryErrorMessage } from '../../../utils/http';
import { downloadUrl } from '../../documents/api';
import {
  FINAL_STATUSES,
  useFinishFollowupMutation,
  useGetFollowupQuery,
  useReviewFollowupMutation,
  type Followup,
} from '../api';
import { FOLLOWUP_TYPE_LABELS } from '../labels';
import AssignDoctorModal from './AssignDoctorModal';
import MessageThread from './MessageThread';
import ReplyBox from './ReplyBox';
import ScheduleFollowupModal from './ScheduleFollowupModal';

const REASON_MIN = 5;

/** Where the booked appointment opens for each role. */
const appointmentLink = (role: Role, id: string) =>
  role === 'patient'
    ? '/patient/appointments'
    : role === 'doctor'
      ? `/doctor/appointments/${id}`
      : `/reception/appointments/${id}`;

/** Where the patient's timeline opens for staff. */
const timelineLink = (role: Role, patientId: string) =>
  role === 'doctor'
    ? `/doctor/patients/${patientId}`
    : `/reception/patients/${patientId}?tab=timeline`;

function Attachments({ request }: { request: Followup }) {
  const { download } = useDownload();
  const [busy, setBusy] = useState<string | null>(null);
  if (request.attachments.length === 0) return null;
  return (
    <ul className="space-y-2">
      {request.attachments.map((a) =>
        a.id ? (
          <li key={a.id}>
            <Button
              variant="ghost"
              size="sm"
              loading={busy === a.id}
              onClick={() => {
                setBusy(a.id);
                void download(downloadUrl(a.id!), a.title ?? 'attachment')
                  .catch((err: unknown) => toast.error(getQueryErrorMessage(err)))
                  .finally(() => setBusy(null));
              }}
            >
              <Paperclip className="h-4 w-4" aria-hidden="true" /> {a.title ?? 'Attachment'}
            </Button>
          </li>
        ) : null,
      )}
    </ul>
  );
}

/** Staff actions: review, assign (reception), schedule, close, reject. */
function StaffActions({ request, role }: { request: Followup; role: Role }) {
  const [dialog, setDialog] = useState<'close' | 'reject' | 'assign' | 'schedule' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [review, reviewing] = useReviewFollowupMutation();
  const [finish, finishing] = useFinishFollowupMutation();
  const final = FINAL_STATUSES.includes(request.status);
  if (final) return null;

  const onFinish = async (outcome: 'close' | 'reject', reason: string) => {
    setError(null);
    try {
      await finish({ id: request.id, outcome, reason }).unwrap();
      toast.success(outcome === 'close' ? 'Request closed' : 'Request rejected');
      setDialog(null);
    } catch (err) {
      setError(getQueryErrorMessage(err));
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      {request.status === 'open' && (
        <Button
          variant="secondary"
          size="sm"
          loading={reviewing.isLoading}
          onClick={() =>
            void review(request.id)
              .unwrap()
              .then(() => toast.success('Marked as in review'))
              .catch((err: unknown) => toast.error(getQueryErrorMessage(err)))
          }
        >
          <Eye className="h-4 w-4" aria-hidden="true" /> Mark in review
        </Button>
      )}
      {role === 'receptionist' && !final && (
        <Button variant="secondary" size="sm" onClick={() => setDialog('assign')}>
          <UserRoundCog className="h-4 w-4" aria-hidden="true" /> Assign doctor
        </Button>
      )}
      {!final && (
        <Button size="sm" onClick={() => setDialog('schedule')}>
          <CalendarCheck className="h-4 w-4" aria-hidden="true" /> Schedule
        </Button>
      )}
      {!final && (
        <Button variant="secondary" size="sm" onClick={() => setDialog('close')}>
          <CircleCheck className="h-4 w-4" aria-hidden="true" /> Close
        </Button>
      )}
      {!final && (
        <Button variant="softDanger" size="sm" onClick={() => setDialog('reject')}>
          <XCircle className="h-4 w-4" aria-hidden="true" /> Reject
        </Button>
      )}
      <ReasonDialog
        open={dialog === 'close' || dialog === 'reject'}
        title={dialog === 'reject' ? 'Reject this request?' : 'Close this request?'}
        label="Reason (the patient sees it)"
        confirmLabel={dialog === 'reject' ? 'Reject' : 'Close request'}
        tone={dialog === 'reject' ? 'danger' : 'primary'}
        minLength={REASON_MIN}
        loading={finishing.isLoading}
        error={error}
        onSubmit={(reason) => void onFinish(dialog === 'reject' ? 'reject' : 'close', reason)}
        onCancel={() => {
          setError(null);
          setDialog(null);
        }}
      />
      {dialog === 'assign' && (
        <AssignDoctorModal request={request} open onClose={() => setDialog(null)} />
      )}
      {dialog === 'schedule' && (
        <ScheduleFollowupModal
          request={request}
          open
          canChooseDoctor={role === 'receptionist'}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

/** The patient's "Mark as resolved" (closes the request). */
function ResolveButton({ request }: { request: Followup }) {
  const [asking, setAsking] = useState(false);
  const [finish, finishing] = useFinishFollowupMutation();
  if (FINAL_STATUSES.includes(request.status)) return null;
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setAsking(true)}>
        <CircleCheck className="h-4 w-4" aria-hidden="true" /> Mark as resolved
      </Button>
      <ConfirmDialog
        open={asking}
        title="Mark this request as resolved?"
        confirmLabel="Mark as resolved"
        loading={finishing.isLoading}
        onCancel={() => setAsking(false)}
        onConfirm={() =>
          void finish({ id: request.id, outcome: 'close', reason: 'Resolved by the patient' })
            .unwrap()
            .then(() => {
              toast.success('Request closed');
              setAsking(false);
            })
            .catch((err: unknown) => toast.error(getQueryErrorMessage(err)))
        }
      >
        The clinic will see it as closed. You can always send a new request.
      </ConfirmDialog>
    </>
  );
}

/**
 * One follow-up request (patient, reception or doctor): what was asked, its status and doctor,
 * the booked appointment, attachments, the thread and the reply box, and the role's actions.
 */
export default function FollowupDetail({ id, role }: { id: string; role: Role }) {
  const query = useGetFollowupQuery(id);
  const r = query.data;
  const isPatient = role === 'patient';

  if (query.isLoading) return <ListSkeleton label="Loading the request…" rows={4} />;
  if (!r) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const final = FINAL_STATUSES.includes(r.status);
  const publicDisabled =
    r.status === 'scheduled'
      ? 'An appointment was booked for this request. Please send a new request if you need anything else.'
      : r.status === 'closed' || r.status === 'rejected'
        ? 'This request is closed. Please send a new request if you need anything else.'
        : null;

  return (
    <div className="space-y-6">
      <SectionCard
        title={
          <span className="flex flex-wrap items-center gap-2">
            {r.requestNumber}
            <StatusPill domain="followup" status={r.status} />
          </span>
        }
        icon={MessageSquare}
        iconTone="primary"
        actions={isPatient ? <ResolveButton request={r} /> : undefined}
      >
        <DescriptionList
          items={[
            { label: 'Type', value: FOLLOWUP_TYPE_LABELS[r.type]?.label ?? r.type },
            { label: 'Sent', value: r.createdAt ? formatDateTime(r.createdAt) : null },
            ...(isPatient
              ? []
              : [
                  {
                    label: 'Patient',
                    value: (
                      <span className="flex flex-wrap items-center gap-2">
                        {r.patient.fullName}
                        {r.patient.mrn && (
                          <span className="tabular text-muted">{r.patient.mrn}</span>
                        )}
                        <Link to={timelineLink(role, r.patient.id)} className={linkClass}>
                          <History className="mr-1 inline h-4 w-4" aria-hidden="true" />
                          Timeline
                        </Link>
                      </span>
                    ),
                  },
                ]),
            {
              label: 'Doctor',
              value: r.assignedDoctor?.name ? `Dr ${r.assignedDoctor.name}` : 'Not assigned yet',
            },
            {
              label: 'Preferred date',
              value: r.preferredDate ? formatCalendarDate(r.preferredDate) : null,
            },
          ]}
        />
        {!isPatient && (
          <div className="mt-5">
            <StaffActions request={r} role={role} />
          </div>
        )}
      </SectionCard>

      {r.status === 'scheduled' && r.resultingAppointmentId && (
        <Alert tone="success" title="Appointment booked">
          <p>A follow-up appointment was booked for this request.</p>
          <Link
            to={appointmentLink(role, r.resultingAppointmentId)}
            className={`mt-2 ${buttonClass('secondary', 'sm')}`}
          >
            <CalendarCheck className="h-4 w-4" aria-hidden="true" /> View appointment
          </Link>
        </Alert>
      )}
      {final && r.closedReason && r.status !== 'scheduled' && (
        <Alert tone="info" title={r.status === 'rejected' ? 'Not accepted' : 'Closed'}>
          {r.closedReason}
        </Alert>
      )}

      {r.attachments.length > 0 && (
        <SectionCard title="Attachments" icon={FileText} iconTone="neutral">
          <Attachments request={r} />
        </SectionCard>
      )}

      <SectionCard title="Conversation" icon={MessageSquare} iconTone="info">
        <div className="space-y-6">
          <MessageThread request={r} viewer={isPatient ? 'patient' : 'staff'} />
          <ReplyBox request={r} canInternal={!isPatient} publicDisabled={publicDisabled} />
        </div>
      </SectionCard>
    </div>
  );
}
