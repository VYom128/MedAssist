import { Sparkles } from 'lucide-react';
import SectionCard from '../../../components/ui/SectionCard';
import type { Encounter } from '../../encounters/api';
import { useGetSummaryQuery } from '../api';
import { useAiFlags } from '../useAiFlags';
import AiSummaryPanel, { ApprovedSummary } from './AiSummaryPanel';

/**
 * The "AI summary" card of a signed note (consult workspace after signing, encounter view).
 * With AI summaries turned off only an already approved summary is shown.
 */
export default function AiSummarySection({
  encounter,
  isOwn,
}: {
  encounter: Encounter;
  isOwn: boolean;
}) {
  const { clinicalSummary } = useAiFlags();
  const title = 'AI summary';
  if (clinicalSummary) {
    return (
      <SectionCard title={title} icon={Sparkles} iconTone="consult">
        <AiSummaryPanel encounter={encounter} canEdit={isOwn} />
      </SectionCard>
    );
  }
  return <ApprovedOnly encounterId={encounter.id} title={title} />;
}

function ApprovedOnly({ encounterId, title }: { encounterId: string; title: string }) {
  const { data } = useGetSummaryQuery(encounterId);
  if (!data?.approved) return null;
  return (
    <SectionCard title={title} icon={Sparkles} iconTone="consult">
      <ApprovedSummary summary={data.approved} />
    </SectionCard>
  );
}
