import { FilePen, FileText, Pill, Printer } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAppSelector } from '../../../app/hooks';
import Button from '../../../components/ui/Button';
import Code from '../../../components/ui/Code';
import ErrorState from '../../../components/ui/ErrorState';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import PageHeader from '../../../components/ui/PageHeader';
import SectionCard from '../../../components/ui/SectionCard';
import StatusPill from '../../../components/ui/StatusPill';
import { linkClass } from '../../../components/ui/linkClass';
import { BLOOD_GROUP_LABELS, GENDER_SHORT } from '../../../constants/catalog';
import { formatDate } from '../../../utils/dates';
import { selectCurrentUser } from '../../auth/authSlice';
import { useListEncountersQuery } from '../../encounters/api';
import AllergyBanner from '../../encounters/components/AllergyBanner';
import { useGetPatientQuery } from '../../patients/api';
import { useListPrescriptionsQuery } from '../../prescriptions/api';
import ClinicalProfileModal from '../components/ClinicalProfileModal';

/**
 * /doctor/patients/:id – a patient the doctor cares for: allergies and chronic conditions
 * (editable), earlier visits and prescriptions. The full timeline comes in Phase 8.
 */
export default function DoctorPatientPage() {
  const { id = '' } = useParams();
  const user = useAppSelector(selectCurrentUser);
  const patient = useGetPatientQuery(id);
  const visits = useListEncountersQuery({ patient: id, limit: 50 });
  const rx = useListPrescriptionsQuery({ patient: id, limit: 50 });
  const [editing, setEditing] = useState(false);
  const p = patient.data;

  return (
    <section className="space-y-6">
      <PageHeader
        back={{ to: '/doctor/patients', label: 'My patients' }}
        title={p ? p.fullName : 'Patient'}
        description={
          p ? (
            <span className="flex flex-wrap items-center gap-2">
              <Code>{p.mrn}</Code>
              <span className="tabular">
                {p.age} y · {GENDER_SHORT[p.gender]} · Blood group{' '}
                {BLOOD_GROUP_LABELS[p.bloodGroup]}
              </span>
            </span>
          ) : undefined
        }
      />
      {patient.isLoading && <ListSkeleton label="Loading patient…" rows={4} />}
      {patient.isError && (
        <ErrorState error={patient.error} onRetry={() => void patient.refetch()} />
      )}
      {p && (
        <>
          <SectionCard
            title="Clinical profile"
            icon={FilePen}
            iconTone="danger"
            actions={
              <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
                Edit allergies and conditions
              </Button>
            }
          >
            <div className="space-y-3">
              <AllergyBanner allergies={p.allergies ?? []} />
              <p className="text-sm">
                <span className="text-muted">Chronic conditions: </span>
                {(p.chronicConditions ?? []).length
                  ? p.chronicConditions!.map((c) => c.name).join(', ')
                  : 'None recorded'}
              </p>
            </div>
          </SectionCard>
          <div className="grid gap-6 lg:grid-cols-2">
            <SectionCard title="Visits" icon={FileText} iconTone="info">
              {visits.isLoading && <ListSkeleton label="Loading visits…" rows={3} />}
              {visits.isError && (
                <ErrorState error={visits.error} onRetry={() => void visits.refetch()} />
              )}
              {visits.data && visits.data.items.length === 0 && (
                <p className="text-sm text-muted">No visit notes yet.</p>
              )}
              <ul className="divide-y divide-line">
                {(visits.data?.items ?? []).map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <Link
                        to={
                          e.status === 'draft' && e.doctor.id === user?.id
                            ? `/doctor/consult/${e.appointmentId}`
                            : `/doctor/encounters/${e.id}`
                        }
                        className={linkClass}
                      >
                        {e.primaryDiagnosis ??
                          (e.status === 'draft' ? 'Draft note' : 'No diagnosis')}
                      </Link>
                      <p className="text-xs text-muted">
                        {formatDate(e.visitAt)} · Dr {e.doctor.name}
                      </p>
                    </div>
                    <StatusPill domain="encounter" status={e.status} size="sm" />
                  </li>
                ))}
              </ul>
            </SectionCard>
            <SectionCard title="Prescriptions" icon={Pill} iconTone="primary">
              {rx.isLoading && <ListSkeleton label="Loading prescriptions…" rows={3} />}
              {rx.isError && <ErrorState error={rx.error} onRetry={() => void rx.refetch()} />}
              {rx.data && rx.data.items.length === 0 && (
                <p className="text-sm text-muted">No prescriptions yet.</p>
              )}
              <ul className="divide-y divide-line">
                {(rx.data?.items ?? []).map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div>
                      <p className="text-sm font-semibold text-ink">
                        {r.prescriptionNumber ?? 'Draft'} · {r.itemCount} drug
                        {r.itemCount === 1 ? '' : 's'}
                      </p>
                      <p className="text-xs text-muted">
                        {r.issuedAt ? formatDate(r.issuedAt) : 'Not issued'} · Dr {r.doctor.name}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusPill domain="prescription" status={r.status} size="sm" />
                      {(r.status === 'issued' || r.status === 'completed') && (
                        <Link
                          to={`/print/prescriptions/${r.id}`}
                          aria-label={`Print ${r.prescriptionNumber}`}
                          className={linkClass}
                        >
                          <Printer className="h-4 w-4" aria-hidden="true" />
                        </Link>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </SectionCard>
          </div>
          <ClinicalProfileModal patient={p} open={editing} onClose={() => setEditing(false)} />
        </>
      )}
    </section>
  );
}
