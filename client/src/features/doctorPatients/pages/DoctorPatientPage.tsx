import { FilePen, FlaskConical, History } from 'lucide-react';
import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import Button from '../../../components/ui/Button';
import Code from '../../../components/ui/Code';
import ErrorState from '../../../components/ui/ErrorState';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import PageHeader from '../../../components/ui/PageHeader';
import SectionCard from '../../../components/ui/SectionCard';
import Tabs from '../../../components/ui/Tabs';
import { BLOOD_GROUP_LABELS, GENDER_SHORT } from '../../../constants/catalog';
import AllergyBanner from '../../encounters/components/AllergyBanner';
import { useGetPatientQuery } from '../../patients/api';
import DocumentsPanel from '../../documents/components/DocumentsPanel';
import PatientLabOrders from '../../labs/components/PatientLabOrders';
import Timeline from '../../timeline/components/Timeline';
import { TIMELINE_FILTERS } from '../../timeline/types';
import ClinicalProfileModal from '../components/ClinicalProfileModal';

const TABS = [
  { id: 'timeline', label: 'Timeline' },
  { id: 'lab', label: 'Lab results' },
  { id: 'documents', label: 'Documents' },
];

/**
 * /doctor/patients/:id – a patient the doctor cares for: allergies and chronic conditions
 * (editable), then tabs: the timeline (default – visits, prescriptions, lab orders, documents,
 * follow-ups; Phase 8), lab results and documents (with uploads).
 */
export default function DoctorPatientPage() {
  const { id = '' } = useParams();
  const patient = useGetPatientQuery(id);
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.id === params.get('tab')) ? params.get('tab')! : 'timeline';
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
          <Tabs
            label="Patient record"
            tabs={TABS}
            value={tab}
            onChange={(next) => setParams({ tab: next }, { replace: true })}
          >
            {tab === 'timeline' && (
              <SectionCard title="Timeline" icon={History} iconTone="primary">
                <Timeline patientId={p.id} types={TIMELINE_FILTERS.doctor} />
              </SectionCard>
            )}
            {tab === 'lab' && (
              <SectionCard title="Lab results" icon={FlaskConical} iconTone="info">
                <PatientLabOrders patientId={p.id} view="doctor" />
              </SectionCard>
            )}
            {tab === 'documents' && <DocumentsPanel patientId={p.id} />}
          </Tabs>
          <ClinicalProfileModal patient={p} open={editing} onClose={() => setEditing(false)} />
        </>
      )}
    </section>
  );
}
