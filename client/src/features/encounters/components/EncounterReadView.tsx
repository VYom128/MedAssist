import DescriptionList from '../../../components/ui/DescriptionList';
import type { Encounter } from '../api';
import { formatDiagnosis, formatFollowUp, formatVitals } from '../fields';

/** A note, read-only (signed and amended notes, quick views). Empty fields show "—". */
export default function EncounterReadView({ encounter: e }: { encounter: Encounter }) {
  const text = (v: string | null) => (v ? <span className="whitespace-pre-line">{v}</span> : '—');
  return (
    <DescriptionList
      columns={2}
      items={[
        { label: 'Chief complaint', value: text(e.chiefComplaint), wide: true },
        { label: 'Vitals', value: formatVitals(e.vitals), wide: true },
        { label: 'History of present illness', value: text(e.historyOfPresentIllness), wide: true },
        { label: 'Past history', value: text(e.pastHistory), wide: true },
        { label: 'Examination', value: text(e.examination), wide: true },
        {
          label: 'Diagnoses',
          wide: true,
          value: e.diagnoses.length ? (
            <ul className="space-y-0.5">
              {e.diagnoses.map((d, i) => (
                <li key={i}>
                  {formatDiagnosis(d)}
                  {d.isPrimary && <span className="text-muted"> · primary</span>}
                </li>
              ))}
            </ul>
          ) : (
            '—'
          ),
        },
        { label: 'Assessment', value: text(e.assessment), wide: true },
        { label: 'Plan', value: text(e.plan), wide: true },
        { label: 'Advice to patient', value: text(e.adviceToPatient), wide: true },
        { label: 'Follow-up', value: formatFollowUp(e.followUp), wide: true },
      ]}
    />
  );
}
