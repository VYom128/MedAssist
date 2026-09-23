import { useState } from 'react';
import { useAppSelector } from '../../../app/hooks';
import PageHeader from '../../../components/PageHeader';
import Tabs from '../../../components/ui/Tabs';
import LeaveTab from '../components/LeaveTab';
import ScheduleTab from '../components/ScheduleTab';

const TABS = [
  { id: 'schedule', label: 'Weekly schedule' },
  { id: 'leave', label: 'Leave' },
];

/** /doctor/schedule – a doctor's own weekly schedule and leave (spec §2.4: U own). */
export default function MySchedulePage() {
  const me = useAppSelector((s) => s.auth.user);
  const [tab, setTab] = useState('schedule');
  if (!me) return null;
  return (
    <section className="mx-auto w-full max-w-5xl">
      <PageHeader
        title="My schedule"
        description="Your weekly hours and leave. Reception books appointments within these."
      />
      <Tabs label="Schedule sections" tabs={TABS} value={tab} onChange={setTab}>
        {tab === 'schedule' ? <ScheduleTab doctorId={me.id} /> : <LeaveTab doctorId={me.id} />}
      </Tabs>
    </section>
  );
}
