import { History } from 'lucide-react';
import PageHeader from '../../../components/ui/PageHeader';
import SectionCard from '../../../components/ui/SectionCard';
import Timeline from '../components/Timeline';
import { TIMELINE_FILTERS } from '../types';

/** /patient/timeline – everything about the patient's care in one list (spec §8.8, §13.1). */
export default function MyTimelinePage() {
  return (
    <section className="mx-auto w-full max-w-5xl">
      <PageHeader
        title="My timeline"
        description="Your visits, prescriptions, lab reports, bills and documents in one place, newest first."
      />
      <SectionCard title="Timeline" icon={History} iconTone="primary">
        <Timeline patientId="me" types={TIMELINE_FILTERS.patient} label="My timeline" />
      </SectionCard>
    </section>
  );
}
