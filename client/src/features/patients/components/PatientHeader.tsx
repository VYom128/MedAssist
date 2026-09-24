import type { ReactNode } from 'react';
import Code from '../../../components/ui/Code';
import RecordHeader from '../../../components/ui/RecordHeader';
import StatusPill from '../../../components/ui/StatusPill';
import { BLOOD_GROUP_LABELS, GENDER_LABELS } from '../../../constants/catalog';
import { formatPhone } from '../../../utils/phone';
import type { Patient } from '../api';
import { portalState } from '../portal';
import AllergyChips from './AllergyChips';
import PortalBadge from './PortalBadge';

/**
 * Header card: avatar, name, MRN, age/sex, blood group, phone, portal status, and allergies in
 * red when the role may see them (not admins, spec §2.5). `actions` holds the page's actions.
 */
export default function PatientHeader({
  patient,
  actions,
}: {
  patient: Patient;
  actions?: ReactNode;
}) {
  const hasAllergies = (patient.allergies?.length ?? 0) > 0;
  return (
    <RecordHeader
      name={patient.fullName}
      meta={
        <>
          <Code>{patient.mrn}</Code>
          <span className="tabular">
            {patient.age} y · {GENDER_LABELS[patient.gender]}
          </span>
          <span aria-hidden="true">·</span>
          <span>Blood group {BLOOD_GROUP_LABELS[patient.bloodGroup]}</span>
          <span aria-hidden="true">·</span>
          <span className="tabular">{formatPhone(patient.phone)}</span>
        </>
      }
      pills={
        <>
          <PortalBadge state={portalState(patient.portal, patient.hasPortal)} />
          {!patient.isActive && <StatusPill domain="record" status="inactive" />}
        </>
      }
      actions={actions}
    >
      {patient.allergies && (
        <div
          className={`rounded-control border p-3 ${
            hasAllergies ? 'border-danger-100 bg-danger-50/50' : 'border-line bg-surface-muted'
          }`}
        >
          <h2
            className={`mb-2 text-caption uppercase ${hasAllergies ? 'text-danger-700' : 'text-muted'}`}
          >
            Allergies
          </h2>
          <AllergyChips allergies={patient.allergies} />
        </div>
      )}
    </RecordHeader>
  );
}
