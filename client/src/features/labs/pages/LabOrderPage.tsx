import {
  BadgeCheck,
  Beaker,
  Download,
  FlaskConical,
  History,
  Printer,
  RotateCcw,
  Send,
  TestTubeDiagonal,
  Undo2,
  UserRound,
} from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAppSelector } from '../../../app/hooks';
import Alert from '../../../components/ui/Alert';
import Badge from '../../../components/ui/Badge';
import Button from '../../../components/ui/Button';
import { buttonClass } from '../../../components/ui/buttonClass';
import ConfirmDialog from '../../../components/ui/ConfirmDialog';
import DescriptionList from '../../../components/ui/DescriptionList';
import ErrorState from '../../../components/ui/ErrorState';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import PageHeader from '../../../components/ui/PageHeader';
import ReasonDialog from '../../../components/ui/ReasonDialog';
import SectionCard from '../../../components/ui/SectionCard';
import StatusPill from '../../../components/ui/StatusPill';
import { GENDER_LABELS, LAB_RULES } from '../../../constants/catalog';
import { useDownload } from '../../../hooks/useFileTransfer';
import { formatDateTime } from '../../../utils/dates';
import { getQueryErrorMessage } from '../../../utils/http';
import { selectCurrentUser } from '../../auth/authSlice';
import {
  reportUrl,
  useGetLabOrderQuery,
  useLabActionMutation,
  useLabReasonActionMutation,
  type LabAction,
  type LabOrder,
} from '../api';
import { OverdueBadge, UrgentPill } from '../components/LabBadges';
import LabItemCard from '../components/LabItemCard';
import { entryProgress, openItems, selfVerificationBlocked } from '../format';

type Reasoned = 'reject-sample' | 'send-back';

/** What the lab does next for the order's status (spec §4.8). */
function ActionPanel({ order, userId }: { order: LabOrder; userId: string | undefined }) {
  const navigate = useNavigate();
  const [act, acting] = useLabActionMutation();
  const [actWithReason, actingWithReason] = useLabReasonActionMutation();
  const [ask, setAsk] = useState<Reasoned | null>(null);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [confirmRelease, setConfirmRelease] = useState(false);
  const { download, busy } = useDownload();
  const run = (action: LabAction, done: string) =>
    act({ id: order.id, action })
      .unwrap()
      .then((updated) => {
        toast.success(done);
        return updated;
      })
      .catch((err: unknown) => {
        toast.error(getQueryErrorMessage(err));
        return null;
      });
  const progress = entryProgress(order);
  const blocked = selfVerificationBlocked(order, userId);

  let body: React.ReactNode;
  switch (order.status) {
    case 'ordered':
      body = (
        <>
          <p className="text-sm text-muted">
            Collect the sample, then print the label for the tube.
          </p>
          <Button
            loading={acting.isLoading}
            onClick={() =>
              void run('collect-sample', 'Sample collected').then((updated) => {
                if (updated) navigate(`/print/lab-labels/${order.id}`);
              })
            }
          >
            <TestTubeDiagonal className="h-4 w-4" aria-hidden="true" /> Collect sample
          </Button>
        </>
      );
      break;
    case 'sample_collected':
      body = (
        <div className="flex flex-wrap gap-2">
          <Button
            loading={acting.isLoading}
            onClick={() => void run('start-processing', 'Processing started')}
          >
            <Beaker className="h-4 w-4" aria-hidden="true" /> Start processing
          </Button>
          <Button variant="secondary" onClick={() => setAsk('reject-sample')}>
            <Undo2 className="h-4 w-4" aria-hidden="true" /> Reject sample
          </Button>
        </div>
      );
      break;
    case 'sample_rejected':
      body = (
        <>
          <Alert tone="warning" title="Sample rejected">
            {order.sample?.rejection?.reason ?? 'No reason recorded'}. The patient and reception
            have been asked to arrange a new sample.
          </Alert>
          <Button
            loading={acting.isLoading}
            onClick={() => void run('recollect', 'Ready for a new sample')}
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" /> Recollect
          </Button>
        </>
      );
      break;
    case 'processing':
      body = (
        <p className="text-sm text-ink" aria-live="polite">
          <span className="font-semibold">
            {progress.done} of {progress.total} tests entered.
          </span>{' '}
          Enter and save the results of each test below; the order moves on to verification when all
          are entered.
        </p>
      );
      break;
    case 'result_entered':
      body = (
        <>
          {blocked && (
            <Alert tone="info" title="Another lab technician must verify">
              You entered results on this order and dual verification is on.
            </Alert>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={blocked}
              loading={acting.isLoading}
              onClick={() => void run('verify', 'Results verified')}
            >
              <BadgeCheck className="h-4 w-4" aria-hidden="true" /> Verify
            </Button>
            <Button variant="secondary" onClick={() => setAsk('send-back')}>
              <Undo2 className="h-4 w-4" aria-hidden="true" /> Send back
            </Button>
          </div>
        </>
      );
      break;
    case 'verified':
      body = (
        <Button onClick={() => setConfirmRelease(true)}>
          <Send className="h-4 w-4" aria-hidden="true" /> Release
        </Button>
      );
      break;
    case 'released':
      body = (
        <>
          <p className="text-sm text-muted">
            Released
            {order.releasedAt ? ` ${formatDateTime(order.releasedAt)}` : ''}
            {order.releasedBy?.name ? ` by ${order.releasedBy.name}` : ''}. Corrections are made
            with &ldquo;Revise result&rdquo; on a test.
          </p>
          {order.reportAvailable && (
            <Button
              variant="secondary"
              loading={busy}
              onClick={() =>
                void download(
                  reportUrl(order.id),
                  `lab-report-${order.orderNumber ?? order.id}.pdf`,
                ).catch((err: unknown) => toast.error(getQueryErrorMessage(err)))
              }
            >
              <Download className="h-4 w-4" aria-hidden="true" /> Download PDF
            </Button>
          )}
        </>
      );
      break;
    default:
      body = (
        <Alert tone="info" title="Cancelled">
          {order.cancellation?.reason ?? 'This order was cancelled.'}
        </Alert>
      );
  }

  return (
    <SectionCard title="Next step" icon={FlaskConical} iconTone="primary">
      <div className="space-y-3">{body}</div>
      <ReasonDialog
        open={ask !== null}
        title={ask === 'reject-sample' ? 'Reject the sample?' : 'Send back for correction?'}
        label="Reason"
        confirmLabel={ask === 'reject-sample' ? 'Reject sample' : 'Send back'}
        tone="danger"
        minLength={LAB_RULES.reasonMin}
        loading={actingWithReason.isLoading}
        error={reasonError}
        onCancel={() => {
          setAsk(null);
          setReasonError(null);
        }}
        onSubmit={(reason) =>
          void actWithReason({ id: order.id, action: ask!, reason })
            .unwrap()
            .then(() => {
              toast.success(
                ask === 'reject-sample' ? 'Sample rejected' : 'Sent back for correction',
              );
              setAsk(null);
            })
            .catch((err: unknown) => setReasonError(getQueryErrorMessage(err)))
        }
      >
        {ask === 'reject-sample'
          ? 'E.g. haemolysed or clotted. The patient and reception are asked to arrange a new sample.'
          : 'The results can be corrected and saved again, then verified.'}
      </ReasonDialog>
      <ConfirmDialog
        open={confirmRelease}
        title="Release these results?"
        confirmLabel="Release"
        loading={acting.isLoading}
        onCancel={() => setConfirmRelease(false)}
        onConfirm={() =>
          void run('release', 'Results released – the patient and doctor are notified').then(() =>
            setConfirmRelease(false),
          )
        }
      >
        The patient and doctor will be able to see these results, and the PDF report is created.
        Later corrections need a revision.
      </ConfirmDialog>
    </SectionCard>
  );
}

function Timeline({ order }: { order: LabOrder }) {
  return (
    <ol className="space-y-3">
      {[...order.statusHistory].reverse().map((h, i) => (
        <li key={`${h.status}-${h.at}-${i}`} className="border-l-2 border-line pl-3">
          <StatusPill domain="labOrder" status={h.status} size="sm" />
          <p className="mt-1 text-xs text-muted">{formatDateTime(h.at)}</p>
          {h.note && <p className="text-sm text-ink">{h.note}</p>}
        </li>
      ))}
    </ol>
  );
}

/**
 * /lab/orders/:id (spec §13.1, §4.8): the order for the lab – header (number, status, priority,
 * patient, allergies, doctor, clinical notes), the next step for its status (collect, reject,
 * recollect, start, verify, send back, release, download), each test with results entry,
 * revisions and cancel, and the status history.
 */
export default function LabOrderPage() {
  const { id = '' } = useParams();
  const user = useAppSelector(selectCurrentUser);
  const { data: order, isLoading, isError, error, refetch } = useGetLabOrderQuery(id);
  const header = (title: string, description?: React.ReactNode) => (
    <PageHeader
      back={{ to: '/lab/worklist', label: 'Worklist' }}
      title={title}
      description={description}
      actions={
        order?.sample?.sampleId ? (
          <Link to={`/print/lab-labels/${id}`} className={buttonClass('secondary', 'sm')}>
            <Printer className="h-4 w-4" aria-hidden="true" /> Print label
          </Link>
        ) : undefined
      }
    />
  );

  if (isLoading) {
    return (
      <section>
        {header('Lab order')}
        <ListSkeleton label="Loading the order…" rows={5} />
      </section>
    );
  }
  if (isError || !order) {
    return (
      <section>
        {header('Lab order')}
        <ErrorState error={error} onRetry={() => void refetch()} />
      </section>
    );
  }

  const p = order.patient;
  return (
    <section>
      {header(
        order.orderNumber ?? 'Lab order',
        <span className="flex flex-wrap items-center gap-2">
          <StatusPill domain="labOrder" status={order.status} />
          <UrgentPill priority={order.priority} />
          <OverdueBadge at={order.tatBreachedAt} />
          {order.hasCritical && <Badge tone="danger">Critical value</Badge>}
        </span>,
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          <ActionPanel order={order} userId={user?.id} />
          <SectionCard
            title="Tests"
            icon={Beaker}
            iconTone="consult"
            description={`${openItems(order).length} of ${order.items.length} tests to perform`}
          >
            <div className="space-y-4">
              {order.items.map((item) => (
                <LabItemCard key={item.id} order={order} item={item} userId={user?.id} />
              ))}
            </div>
          </SectionCard>
        </div>
        <aside className="space-y-6" aria-label="Order details">
          <SectionCard title={p.fullName} icon={UserRound} iconTone="info">
            <DescriptionList
              columns={1}
              items={[
                { label: 'MRN', value: p.mrn },
                { label: 'Age / sex', value: `${p.age} years · ${GENDER_LABELS[p.gender]}` },
                {
                  label: 'Allergies',
                  value: p.allergies?.length ? (
                    <ul aria-label="Allergies" className="flex flex-wrap gap-1.5">
                      {p.allergies.map((a) => (
                        <li key={a.substance}>
                          <Badge tone="danger">
                            {a.substance} ({a.severity})
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    'No known allergies'
                  ),
                },
              ]}
            />
          </SectionCard>
          <SectionCard title="Order" icon={FlaskConical} iconTone="primary">
            <DescriptionList
              columns={1}
              items={[
                { label: 'Ordered by', value: `Dr ${order.orderedBy.name}` },
                {
                  label: 'Ordered',
                  value: order.orderedAt ? formatDateTime(order.orderedAt) : '—',
                },
                { label: 'Clinical notes', value: order.clinicalNotes ?? '—' },
                { label: 'Sample ID', value: order.sample?.sampleId ?? 'Not collected yet' },
                ...(order.sample?.collectedAt
                  ? [
                      {
                        label: 'Collected',
                        value: `${formatDateTime(order.sample.collectedAt)}${order.sample.collectedBy?.name ? ` by ${order.sample.collectedBy.name}` : ''}`,
                      },
                    ]
                  : []),
              ]}
            />
          </SectionCard>
          <SectionCard title="History" icon={History} iconTone="neutral">
            <Timeline order={order} />
          </SectionCard>
        </aside>
      </div>
    </section>
  );
}
