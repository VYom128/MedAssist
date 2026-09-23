import { zodResolver } from '@hookform/resolvers/zod';
import { Pencil } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import toast from 'react-hot-toast';
import Alert from '../../../components/ui/Alert';
import Button from '../../../components/ui/Button';
import Card from '../../../components/ui/Card';
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

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-slate-500">{label}</dt>
      <dd className="mt-0.5 font-medium break-words text-slate-800">{children ?? '—'}</dd>
    </div>
  );
}

const joinAddress = (a: Patient['address']) =>
  a ? [a.line1, a.line2, a.city, a.state, a.postalCode, a.country].filter(Boolean).join(', ') : '';

const yesNo = (v: boolean) => (v ? 'Yes' : 'No');

/** Everything the role may see, read-only. */
function PatientDetails({ patient: p }: { patient: Patient }) {
  return (
    <div className="space-y-4">
      <Card title="Basic details">
        <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Detail label="Date of birth">
            {formatCalendarDate(p.dateOfBirth)} ({p.age} y)
          </Detail>
          <Detail label="Gender">{GENDER_LABELS[p.gender]}</Detail>
          <Detail label="Blood group">{BLOOD_GROUP_LABELS[p.bloodGroup]}</Detail>
          <Detail label="Registered">{formatDate(p.registeredAt)}</Detail>
        </dl>
      </Card>
      <Card title="Contact">
        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <Detail label="Mobile number">{formatPhone(p.phone)}</Detail>
          <Detail label="Email">{p.email || '—'}</Detail>
          <Detail label="Address">{joinAddress(p.address) || '—'}</Detail>
          <Detail label="Emergency contact">
            {p.emergencyContact?.name
              ? `${p.emergencyContact.name}${p.emergencyContact.relation ? ` (${p.emergencyContact.relation})` : ''} · ${formatPhone(p.emergencyContact.phone)}`
              : '—'}
          </Detail>
        </dl>
      </Card>
      {p.allergies && (
        <Card title="Allergies">
          <AllergyChips allergies={p.allergies} />
        </Card>
      )}
      {p.insurance !== undefined && (
        <Card title="Insurance">
          {p.insurance ? (
            <dl className="grid gap-4 text-sm sm:grid-cols-3">
              <Detail label="Insurer">{p.insurance.provider || '—'}</Detail>
              <Detail label="Policy number">{p.insurance.policyNumber || '—'}</Detail>
              <Detail label="Valid till">{formatCalendarDate(p.insurance.validTill)}</Detail>
            </dl>
          ) : (
            <p className="text-sm text-slate-500">No insurance recorded.</p>
          )}
        </Card>
      )}
      <Card title="Preferences and consent">
        <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Detail label="Preferred language">{LANGUAGE_LABELS[p.preferredLanguage]}</Detail>
          <Detail label="Data processing consent">
            {p.consent.dataProcessing.given
              ? `Given ${formatDate(p.consent.dataProcessing.at)}`
              : 'Not given'}
          </Detail>
          <Detail label="AI explanations">{yesNo(p.consent.aiExplanations.given)}</Detail>
          <Detail label="Email reminders">{yesNo(p.consent.communications.email)}</Detail>
          <Detail label="SMS reminders">{yesNo(p.consent.communications.sms)}</Detail>
          {p.adminNotes !== undefined && (
            <Detail label="Front-desk notes">{p.adminNotes || '—'}</Detail>
          )}
        </dl>
      </Card>
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
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
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
    <div className="space-y-4">
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
