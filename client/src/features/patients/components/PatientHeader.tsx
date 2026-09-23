import Badge from '../../../components/ui/Badge';
import { GENDER_LABELS } from '../../../constants/catalog';
import { formatPhone } from '../../../utils/phone';
import type { Patient } from '../api';
import { portalState } from '../portal';
import AllergyChips from './AllergyChips';
import PortalBadge from './PortalBadge';

/**
 * Name, MRN, age/sex, phone, portal status, and allergies in red when the role may see them
 * (not admins, spec §2.5).
 */
export default function PatientHeader({ patient }: { patient: Patient }) {
  return (
    <header className="mb-6 space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold break-words">{patient.fullName}</h1>
          <p className="mt-1 text-sm text-slate-600">
            <span className="font-mono">{patient.mrn}</span> · {patient.age} y ·{' '}
            {GENDER_LABELS[patient.gender]} · {formatPhone(patient.phone)}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <PortalBadge state={portalState(patient.portal, patient.hasPortal)} />
          {!patient.isActive && <Badge tone="neutral">Inactive</Badge>}
        </div>
      </div>
      {patient.allergies && (
        <div>
          <h2 className="sr-only">Allergies</h2>
          <AllergyChips allergies={patient.allergies} />
        </div>
      )}
    </header>
  );
}
