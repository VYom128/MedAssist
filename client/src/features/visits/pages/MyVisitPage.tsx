import {
  CalendarPlus,
  ClipboardList,
  FileText,
  HeartPulse,
  Link2,
  MessageSquareText,
  Stethoscope,
} from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import Alert from '../../../components/ui/Alert';
import DescriptionList from '../../../components/ui/DescriptionList';
import EmptyState from '../../../components/ui/EmptyState';
import ErrorState from '../../../components/ui/ErrorState';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import PageHeader from '../../../components/ui/PageHeader';
import SectionCard from '../../../components/ui/SectionCard';
import StatusPill from '../../../components/ui/StatusPill';
import { buttonClass } from '../../../components/ui/buttonClass';
import { linkClass } from '../../../components/ui/linkClass';
import { VITALS } from '../../../constants/catalog';
import { formatCalendarDate, formatDate, formatDateTime } from '../../../utils/dates';
import { isApiQueryError } from '../../../utils/http';
import { useListInvoicesQuery } from '../../billing/api';
import { followUpBookingLink, useGetMyVisitQuery, type PatientVisit } from '../api';

const num = (v: number | null) => (v === null ? null : String(v));

/** Vitals in plain words, only those recorded. */
function vitalsItems(v: PatientVisit['vitals']) {
  const bp =
    v.bpSystolic !== null && v.bpDiastolic !== null
      ? `${v.bpSystolic}/${v.bpDiastolic} mmHg`
      : null;
  const one = (key: keyof typeof VITALS) => {
    const value = num(v[key]);
    return value ? `${value} ${VITALS[key].unit}` : null;
  };
  return [
    { label: 'Blood pressure', value: bp },
    { label: 'Pulse', value: one('pulse') },
    { label: 'Temperature', value: one('temperatureC') },
    { label: 'Oxygen (SpO₂)', value: v.spo2 !== null ? `${v.spo2} %` : null },
    { label: 'Weight', value: one('weightKg') },
    { label: 'Height', value: one('heightCm') },
    { label: 'BMI', value: num(v.bmi) },
  ].filter((i) => i.value !== null);
}

/** The follow-up plan in plain words. */
function followUpText(f: PatientVisit['followUp']) {
  if (!f.required) return null;
  if (f.date) return `Your doctor would like to see you again on ${formatCalendarDate(f.date)}.`;
  if (f.afterDays) {
    return `Your doctor would like to see you again in ${f.afterDays} day${f.afterDays === 1 ? '' : 's'}.`;
  }
  return 'Your doctor would like to see you again.';
}

/** The invoices of this visit (the patient's own, issued). */
function VisitInvoices({ appointmentId }: { appointmentId: string }) {
  const { data } = useListInvoicesQuery({ appointment: appointmentId, limit: 5 });
  if (!data || data.items.length === 0) return null;
  return (
    <>
      {data.items.map((inv) => (
        <li key={inv.id}>
          <Link to={`/patient/invoices/${inv.id}`} className={linkClass}>
            Invoice {inv.invoiceNumber ?? ''}
          </Link>
        </li>
      ))}
    </>
  );
}

/**
 * /patient/visits/:id – the patient-safe visit summary (Phase 8): date, doctor, department,
 * vitals, advice and the follow-up plan, with links to the prescription, lab reports and invoice
 * of the visit. Diagnoses only when the doctor shared them; never history, examination,
 * assessment or plan (the server leaves them out).
 */
export default function MyVisitPage() {
  const { id = '' } = useParams();
  const visit = useGetMyVisitQuery(id);
  const v = visit.data;
  const back = { to: '/patient/visits', label: 'My visits' };

  if (visit.isLoading) {
    return (
      <section className="mx-auto w-full max-w-5xl">
        <PageHeader back={back} title="Visit summary" />
        <ListSkeleton label="Loading the visit…" rows={4} />
      </section>
    );
  }
  if (!v) {
    const notFound = isApiQueryError(visit.error) && visit.error.status === 404;
    return (
      <section className="mx-auto w-full max-w-5xl">
        <PageHeader back={back} title="Visit summary" />
        {notFound ? (
          <EmptyState
            icon={FileText}
            title="Visit not found"
            description="It may not be signed yet, or it belongs to someone else."
          />
        ) : (
          <ErrorState error={visit.error} onRetry={() => void visit.refetch()} />
        )}
      </section>
    );
  }

  const vitals = vitalsItems(v.vitals);
  const followUp = followUpText(v.followUp);

  return (
    <section className="mx-auto w-full max-w-5xl space-y-6">
      <PageHeader
        back={back}
        eyebrow="Visit summary"
        title={`Visit on ${formatDate(v.visitAt)}`}
        description={`Dr ${v.doctor.name}${v.department ? ` · ${v.department.name}` : ''}`}
        actions={<StatusPill domain="encounter" status={v.status} />}
      />
      {v.amended && (
        <Alert tone="info" title="Updated after the visit">
          Your doctor corrected this summary after signing it. You are seeing the latest version.
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title="Vitals" icon={HeartPulse} iconTone="danger">
          {vitals.length > 0 ? (
            <DescriptionList items={vitals} />
          ) : (
            <p className="text-sm text-muted">No vitals were recorded at this visit.</p>
          )}
        </SectionCard>

        {v.diagnosisShared && v.diagnoses && (
          <SectionCard title="Diagnosis" icon={Stethoscope} iconTone="consult">
            {v.diagnoses.length > 0 ? (
              <ul className="space-y-1 text-sm">
                {v.diagnoses.map((d, i) => (
                  <li key={i} className="text-ink">
                    {d.description}
                    {d.isPrimary && v.diagnoses!.length > 1 && (
                      <span className="text-muted"> (main)</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">No diagnosis was recorded.</p>
            )}
          </SectionCard>
        )}

        <SectionCard title="Advice from your doctor" icon={MessageSquareText} iconTone="primary">
          <p className="text-sm whitespace-pre-line text-body">
            {v.adviceToPatient ?? 'No written advice for this visit.'}
          </p>
        </SectionCard>

        <SectionCard
          title="Follow-up"
          icon={CalendarPlus}
          iconTone="info"
          actions={
            followUp ? (
              <Link
                to={followUpBookingLink({
                  booking: {
                    doctorId: v.doctor.id,
                    followUpOf: v.appointmentId,
                    type: 'follow_up',
                  },
                })}
                className={buttonClass('secondary', 'sm')}
              >
                Book follow-up
              </Link>
            ) : undefined
          }
        >
          <p className="text-sm text-body">{followUp ?? 'No follow-up visit is planned.'}</p>
          {v.followUp.required && v.followUp.instructions && (
            <p className="mt-2 text-sm text-muted">{v.followUp.instructions}</p>
          )}
        </SectionCard>
      </div>

      <SectionCard title="From this visit" icon={Link2} iconTone="neutral">
        <ul className="space-y-2 text-sm">
          {v.prescriptionId && (
            <li>
              <Link to={`/patient/prescriptions/${v.prescriptionId}`} className={linkClass}>
                Prescription
              </Link>
            </li>
          )}
          {v.labOrders.map((o) => (
            <li key={o.id}>
              <Link to={`/patient/lab-reports/${o.id}`} className={linkClass}>
                Lab report {o.orderNumber ?? ''}
              </Link>
            </li>
          ))}
          <VisitInvoices appointmentId={v.appointmentId} />
        </ul>
        {!v.prescriptionId && v.labOrders.length === 0 && (
          <p className="mt-1 text-sm text-muted">
            <ClipboardList className="mr-1 inline h-4 w-4" aria-hidden="true" />
            No prescription or released lab report for this visit.
          </p>
        )}
        {v.signedAt && (
          <p className="mt-4 text-xs text-subtle">Signed {formatDateTime(v.signedAt)}</p>
        )}
      </SectionCard>
    </section>
  );
}
