import type { ReactNode } from 'react';
import Code from '../../../components/ui/Code';
import {
  APPOINTMENT_TYPE_LABELS,
  BLOOD_GROUP_LABELS,
  GENDER_SHORT,
} from '../../../constants/catalog';
import type { Appointment } from '../../appointments/api';
import type { Patient } from '../../patients/api';
import AllergyBanner from './AllergyBanner';

/**
 * Sticky patient header of the consult workspace (spec §4.7 step 2, §13.4 #4): who, the red
 * allergy banner, chronic conditions, why they came – and `status`/`actions` on the right
 * (autosave status, Review & sign).
 */
export default function ConsultHeader({
  patient,
  appointment,
  status,
  actions,
}: {
  patient: Patient;
  appointment: Appointment | undefined;
  status?: ReactNode;
  actions?: ReactNode;
}) {
  const conditions = patient.chronicConditions ?? [];
  return (
    <header className="sticky top-0 z-20 -mx-4 border-b border-line bg-surface/95 px-4 py-3 shadow-card backdrop-blur sm:mx-0 sm:rounded-card sm:border">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="text-page text-ink">{patient.fullName}</h1>
            <Code>{patient.mrn}</Code>
            <span className="tabular text-sm text-muted">
              {patient.age} y · {GENDER_SHORT[patient.gender]} · Blood group{' '}
              {BLOOD_GROUP_LABELS[patient.bloodGroup]}
            </span>
          </div>
          <AllergyBanner allergies={patient.allergies ?? []} />
          <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
            <div className="flex gap-1.5">
              <dt className="text-muted">Conditions:</dt>
              <dd className="text-ink">
                {conditions.length ? conditions.map((c) => c.name).join(', ') : 'None recorded'}
              </dd>
            </div>
            {appointment && (
              <div className="flex gap-1.5">
                <dt className="text-muted">{APPOINTMENT_TYPE_LABELS[appointment.type]}:</dt>
                <dd className="text-ink">{appointment.reason ?? 'No reason given'}</dd>
              </div>
            )}
          </dl>
        </div>
        <div className="flex flex-wrap items-center gap-3 lg:justify-end">
          {status}
          {actions}
        </div>
      </div>
    </header>
  );
}
