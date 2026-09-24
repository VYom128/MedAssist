import { FilePen, FileText, Pill, Printer } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import Badge from '../../../components/ui/Badge';
import Button from '../../../components/ui/Button';
import { buttonClass } from '../../../components/ui/buttonClass';
import SectionCard from '../../../components/ui/SectionCard';
import StatusPill from '../../../components/ui/StatusPill';
import { formatDateTime } from '../../../utils/dates';
import { useCurrentPrescription } from '../../prescriptions/useCurrentPrescription';
import type { Encounter } from '../api';
import AmendmentHistory from './AmendmentHistory';
import AmendModal from './AmendModal';
import EncounterReadView from './EncounterReadView';
import PrescriptionTab from './PrescriptionTab';

/**
 * A signed or amended note, read-only (spec §5.2): who signed it and when, the version, the
 * note, its prescription, the amendment history – and "Amend" for the note's own doctor.
 */
export default function SignedNoteView({
  encounter: e,
  canAmend,
}: {
  encounter: Encounter;
  canAmend: boolean;
}) {
  const [amending, setAmending] = useState(false);
  const current = useCurrentPrescription(e.id);
  const rx = current.prescription;
  return (
    <div className="space-y-6">
      <SectionCard
        title="Visit note"
        icon={FileText}
        iconTone="success"
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusPill domain="encounter" status={e.status} size="sm" />
            <Badge tone="neutral">Version {e.version}</Badge>
            <span>
              Signed by Dr {e.doctor.name}
              {e.signedAt ? ` on ${formatDateTime(e.signedAt)}` : ''}
              {e.lastAmendedAt ? ` · last amended ${formatDateTime(e.lastAmendedAt)}` : ''}
            </span>
          </span>
        }
        actions={
          canAmend ? (
            <Button variant="secondary" size="sm" onClick={() => setAmending(true)}>
              <FilePen className="h-4 w-4" aria-hidden="true" /> Amend
            </Button>
          ) : undefined
        }
      >
        <EncounterReadView encounter={e} />
      </SectionCard>
      <SectionCard
        title="Prescription"
        icon={Pill}
        iconTone="primary"
        actions={
          rx && rx.status !== 'draft' ? (
            <Link
              to={`/doctor/prescriptions/${rx.id}/print`}
              className={buttonClass('secondary', 'sm')}
            >
              <Printer className="h-4 w-4" aria-hidden="true" /> Print
            </Link>
          ) : undefined
        }
      >
        <PrescriptionTab current={current} />
      </SectionCard>
      <AmendmentHistory encounterId={e.id} />
      {canAmend && <AmendModal encounter={e} open={amending} onClose={() => setAmending(false)} />}
    </div>
  );
}
