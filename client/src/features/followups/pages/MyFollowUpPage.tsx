import { useParams } from 'react-router-dom';
import PageHeader from '../../../components/ui/PageHeader';
import EmergencyBanner from '../components/EmergencyBanner';
import FollowupDetail from '../components/FollowupDetail';

/** /patient/follow-ups/:id – one request as a conversation with the clinic. */
export default function MyFollowUpPage() {
  const { id = '' } = useParams();
  return (
    <section className="mx-auto w-full max-w-5xl space-y-6">
      <PageHeader
        back={{ to: '/patient/follow-ups', label: 'Follow-ups' }}
        title="Follow-up request"
      />
      <EmergencyBanner />
      <FollowupDetail id={id} role="patient" />
    </section>
  );
}
