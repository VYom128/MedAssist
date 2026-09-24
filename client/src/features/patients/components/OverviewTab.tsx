import { zodResolver } from '@hookform/resolvers/zod';
import { HeartPulse, Languages, Pencil, Phone, ShieldCheck, UserRound } from 'lucide-react';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import toast from 'react-hot-toast';
import Alert from '../../../components/ui/Alert';
import Button from '../../../components/ui/Button';
import DescriptionList from '../../../components/ui/DescriptionList';
import SectionCard from '../../../components/ui/SectionCard';
import { BLOOD_GROUP_LABELS, GENDER_LABELS, LANGUAGE_LABELS } from '../../../constants/catalog';
import { useUnsavedChanges } from '../../../hooks/useUnsavedChanges';
import { formatCalendarDate, formatDate } from '../../../utils/dates';
import { applyServerFieldErrorsByPath } from '../../../utils/forms';
import { getQueryErrorMessage, isApiQueryError } from '../../../utils/http';
import { formatPhone, normalisePhone } from '../../../utils/phone';
import { useUpdatePatientMutation, type DuplicateMatch, type Patient } from '../api';
import {
  patientFormSchema,
  patientToForm,
  toPatientBody,
  type PatientFormValues,
} from '../schemas';
import AllergyChips from './AllergyChips';
import DuplicatePanel from './DuplicatePanel';
import PatientFormSections from './PatientFormSections';
import { useDuplicateCheck } from './useDuplicateCheck';

const joinAddress = (a: Patient['address']) =>
  a ? [a.line1, a.line2, a.city, a.state, a.postalCode, a.country].filter(Boolean).join(', ') : '';

const yesNo = (v: boolean) => (v ? 'Yes' : 'No');

/** Everything the role may see, read-only. */
function PatientDetails({ patient: p }: { patient: Patient }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <SectionCard title="Basic details" icon={UserRound}>
        <DescriptionList
          items={[
            {
              label: 'Date of birth',
              value: `${formatCalendarDate(p.dateOfBirth)} (${p.age} y)`,
            },
            { label: 'Gender', value: GENDER_LABELS[p.gender] },
            { label: 'Blood group', value: BLOOD_GROUP_LABELS[p.bloodGroup] },
            { label: 'Registered', value: formatDate(p.registeredAt) },
          ]}
        />
      </SectionCard>
      <SectionCard title="Contact" icon={Phone}>
        <DescriptionList
          items={[
            { label: 'Mobile number', value: formatPhone(p.phone) },
            { label: 'Email', value: p.email },
            { label: 'Address', value: joinAddress(p.address), wide: true },
            {
              label: 'Emergency contact',
              wide: true,
              value: p.emergencyContact?.name
                ? `${p.emergencyContact.name}${p.emergencyContact.relation ? ` (${p.emergencyContact.relation})` : ''} · ${formatPhone(p.emergencyContact.phone)}`
                : null,
            },
          ]}
        />
      </SectionCard>
      {p.allergies && (
        <SectionCard title="Allergies" icon={HeartPulse} iconTone="danger">
          <AllergyChips allergies={p.allergies} />
        </SectionCard>
      )}
      {p.insurance !== undefined && (
        <SectionCard title="Insurance" icon={ShieldCheck}>
          {p.insurance ? (
            <DescriptionList
              columns={3}
              items={[
                { label: 'Insurer', value: p.insurance.provider },
                { label: 'Policy number', value: p.insurance.policyNumber },
                { label: 'Valid till', value: formatCalendarDate(p.insurance.validTill) },
              ]}
            />
          ) : (
            <p className="text-sm text-muted">No insurance recorded.</p>
          )}
        </SectionCard>
      )}
      <SectionCard title="Preferences and consent" icon={Languages} className="lg:col-span-2">
        <DescriptionList
          columns={3}
          items={[
            { label: 'Preferred language', value: LANGUAGE_LABELS[p.preferredLanguage] },
            {
              label: 'Data processing consent',
              value: p.consent.dataProcessing.given
                ? `Given ${formatDate(p.consent.dataProcessing.at)}`
                : 'Not given',
            },
            { label: 'AI explanations', value: yesNo(p.consent.aiExplanations.given) },
            { label: 'Email reminders', value: yesNo(p.consent.communications.email) },
            { label: 'SMS reminders', value: yesNo(p.consent.communications.sms) },
            ...(p.adminNotes !== undefined
              ? [{ label: 'Front-desk notes', value: p.adminNotes }]
              : []),
          ]}
        />
      </SectionCard>
    </div>
  );
}

/** Edit form; changing phone or DOB re-runs the duplicate check (spec §4.3). */
function EditPatient({
  patient,
  basePath,
  canEditAllergies,
  onDone,
}: {
  patient: Patient;
  basePath: string;
  canEditAllergies: boolean;
  onDone: () => void;
}) {
  const [updatePatient, { isLoading: saving }] = useUpdatePatientMutation();
  const [serverMatches, setServerMatches] = useState<DuplicateMatch[] | null>(null);
  const [overrideReason, setOverrideReason] = useState<string | null>(null);
  const form = useForm<PatientFormValues>({
    resolver: zodResolver(patientFormSchema),
    defaultValues: patientToForm(patient),
  });
  const {
    handleSubmit,
    setError,
    control,
    formState: { errors, isDirty, isSubmitSuccessful },
  } = form;
  const [firstName, lastName, dateOfBirth, phone] = useWatch({
    control,
    name: ['firstName', 'lastName', 'dateOfBirth', 'phone'],
  });
  const identityChanged =
    dateOfBirth !== patient.dateOfBirth || (normalisePhone(phone) ?? phone) !== patient.phone;
  const liveMatches = useDuplicateCheck(
    { firstName, lastName, dateOfBirth, phone },
    { enabled: identityChanged, excludeId: patient.id },
  );
  const matches = identityChanged ? (serverMatches ?? liveMatches) : [];
  const leaveGuard = useUnsavedChanges(isDirty && !saving && !isSubmitSuccessful);

  const save = (reason: string | null) =>
    handleSubmit(async (values) => {
      try {
        await updatePatient({
          id: patient.id,
          body: {
            ...toPatientBody(values, { allergies: canEditAllergies, consent: false }),
            ...(reason ? { force: true, reason } : {}),
          },
        }).unwrap();
        toast.success('Patient details saved');
        onDone();
      } catch (err) {
        if (isApiQueryError(err) && err.code === 'DUPLICATE_PATIENT') {
          setServerMatches((err.details as { matches?: DuplicateMatch[] })?.matches ?? []);
          setOverrideReason(null);
          return;
        }
        if (!applyServerFieldErrorsByPath(err, setError, (path) => path)) {
          setError('root', { message: getQueryErrorMessage(err) });
        }
      }
    })();

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save(overrideReason);
      }}
    >
      {errors.root && <Alert tone="error">{errors.root.message}</Alert>}
      <PatientFormSections
        form={form}
        showAllergies={canEditAllergies}
        showConsent={false}
        afterContact={
          <DuplicatePanel
            matches={matches}
            basePath={basePath}
            overrideReason={overrideReason}
            saving={saving}
            onDifferentPerson={(reason) => {
              setOverrideReason(reason);
              void save(reason);
            }}
          />
        }
      />
      <div className="sticky bottom-0 z-10 -mx-4 flex flex-col-reverse gap-2 border-t border-line bg-surface/90 px-4 py-3 backdrop-blur-md sm:mx-0 sm:flex-row sm:justify-end sm:rounded-card sm:border sm:shadow-card-hover">
        <Button variant="ghost" onClick={onDone} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" loading={saving} disabled={!isDirty}>
          Save changes
        </Button>
      </div>
      {leaveGuard}
    </form>
  );
}

/** Overview tab: the record, and an edit mode for reception. */
export default function OverviewTab({
  patient,
  basePath,
  canEdit,
  canEditAllergies,
}: {
  patient: Patient;
  basePath: string;
  canEdit: boolean;
  canEditAllergies: boolean;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <EditPatient
        patient={patient}
        basePath={basePath}
        canEditAllergies={canEditAllergies}
        onDone={() => setEditing(false)}
      />
    );
  }
  return (
    <div className="space-y-4 motion-safe:animate-fade-in">
      {canEdit && (
        <div className="flex justify-end">
          <Button variant="secondary" onClick={() => setEditing(true)}>
            <Pencil className="h-4 w-4" aria-hidden="true" /> Edit details
          </Button>
        </div>
      )}
      <PatientDetails patient={patient} />
    </div>
  );
}
