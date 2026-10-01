import { CheckCheck, Download, FlaskConical, UserRound } from 'lucide-react';
import toast from 'react-hot-toast';
import { Link, useParams } from 'react-router-dom';
import Alert from '../../../components/ui/Alert';
import Badge from '../../../components/ui/Badge';
import Button from '../../../components/ui/Button';
import DescriptionList from '../../../components/ui/DescriptionList';
import ErrorState from '../../../components/ui/ErrorState';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import PageHeader from '../../../components/ui/PageHeader';
import SectionCard from '../../../components/ui/SectionCard';
import StatusPill from '../../../components/ui/StatusPill';
import { linkClass } from '../../../components/ui/linkClass';
import { GENDER_LABELS } from '../../../constants/catalog';
import { useDownload } from '../../../hooks/useFileTransfer';
import { formatDateTime } from '../../../utils/dates';
import { getQueryErrorMessage } from '../../../utils/http';
import { reportUrl, useGetLabOrderQuery, useLabActionMutation, type LabOrder } from '../api';
import LabOrderResults from '../components/LabOrderResults';
import { UrgentPill } from '../components/LabBadges';

const REVIEWABLE = ['result_entered', 'verified', 'released'];

/** Results (or a critical value) the doctor can acknowledge now. */
const canAcknowledge = (o: LabOrder) =>
  !o.reviewedByDoctorAt &&
  (REVIEWABLE.includes(o.status) || (o.hasCritical && o.status !== 'cancelled'));

/**
 * /doctor/lab-orders/:id – a lab order for the doctor: the results with flags and reference
 * ranges (unverified ones marked), the PDF once released, and "Acknowledge" to take it off
 * "Results to review" (and end a critical alert).
 */
export default function DoctorLabOrderPage() {
  const { id = '' } = useParams();
  const { data: order, isLoading, isError, error, refetch } = useGetLabOrderQuery(id);
  const [act, acting] = useLabActionMutation();
  const { download, busy } = useDownload();
  const back = { to: '/doctor/lab-results', label: 'Lab results' };

  if (isLoading || isError || !order) {
    return (
      <section>
        <PageHeader back={back} title="Lab order" />
        {isLoading ? (
          <ListSkeleton label="Loading results…" rows={4} />
        ) : (
          <ErrorState error={error} onRetry={() => void refetch()} />
        )}
      </section>
    );
  }
  const unverified = order.items.some((i) => i.unverified);
  return (
    <section>
      <PageHeader
        back={back}
        title={order.orderNumber ?? 'Lab order'}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusPill domain="labOrder" status={order.status} />
            <UrgentPill priority={order.priority} />
            {order.hasCritical && <Badge tone="danger">Critical value</Badge>}
          </span>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            {order.reportAvailable && (
              <Button
                variant="secondary"
                loading={busy}
                onClick={() =>
                  void download(reportUrl(order.id), `lab-report-${order.orderNumber}.pdf`).catch(
                    (err: unknown) => toast.error(getQueryErrorMessage(err)),
                  )
                }
              >
                <Download className="h-4 w-4" aria-hidden="true" /> PDF report
              </Button>
            )}
            {canAcknowledge(order) && (
              <Button
                loading={acting.isLoading}
                onClick={() =>
                  void act({ id: order.id, action: 'acknowledge' })
                    .unwrap()
                    .then(() => toast.success('Marked as reviewed'))
                    .catch((err: unknown) => toast.error(getQueryErrorMessage(err)))
                }
              >
                <CheckCheck className="h-4 w-4" aria-hidden="true" /> Acknowledge
              </Button>
            )}
          </div>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 space-y-6">
          {unverified && (
            <Alert tone="warning" title="Some results are not verified yet">
              The lab may still correct them. You are told when they are released.
            </Alert>
          )}
          {order.reviewedByDoctorAt && (
            <Alert tone="success" title={`Reviewed ${formatDateTime(order.reviewedByDoctorAt)}`} />
          )}
          <SectionCard title="Results" icon={FlaskConical} iconTone="info">
            <LabOrderResults order={order} />
          </SectionCard>
        </div>
        <SectionCard title={order.patient.fullName} icon={UserRound} iconTone="info">
          <DescriptionList
            columns={1}
            items={[
              { label: 'MRN', value: order.patient.mrn },
              {
                label: 'Age / sex',
                value: `${order.patient.age} years · ${GENDER_LABELS[order.patient.gender]}`,
              },
              { label: 'Ordered', value: order.orderedAt ? formatDateTime(order.orderedAt) : '—' },
              {
                label: 'Released',
                value: order.releasedAt ? formatDateTime(order.releasedAt) : '—',
              },
              { label: 'Notes for the lab', value: order.clinicalNotes ?? '—' },
            ]}
          />
          <Link
            to={`/doctor/patients/${order.patient.id}`}
            className={`${linkClass} mt-3 inline-block text-sm`}
          >
            Open patient
          </Link>
        </SectionCard>
      </div>
    </section>
  );
}
