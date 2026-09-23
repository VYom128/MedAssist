import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Link } from 'react-router-dom';
import { VERIFY_IDENTITY_PATH } from '../../../routes/home';
import PageHeader from '../../../components/PageHeader';
import Alert from '../../../components/ui/Alert';
import Button from '../../../components/ui/Button';
import Card from '../../../components/ui/Card';
import ConfirmDialog from '../../../components/ui/ConfirmDialog';
import ErrorState from '../../../components/ui/ErrorState';
import Input from '../../../components/ui/Input';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import Select from '../../../components/ui/Select';
import Switch from '../../../components/ui/Switch';
import {
  BLOOD_GROUP_LABELS,
  GENDER_LABELS,
  LANGUAGE_LABELS,
  PATIENT_LANGUAGES,
  optionsOf,
} from '../../../constants/catalog';
import { useUnsavedChanges } from '../../../hooks/useUnsavedChanges';
import { formatCalendarDate, formatDate } from '../../../utils/dates';
import { applyServerFieldErrorsByPath } from '../../../utils/forms';
import { getQueryErrorMessage, isApiQueryError } from '../../../utils/http';
import {
  useGetMyPatientQuery,
  useUpdateMyPatientMutation,
  type MyDetailsBody,
  type Patient,
} from '../api';
import AllergyChips from '../components/AllergyChips';
import {
  myDetailsSchema,
  myDetailsToForm,
  toMyDetailsBody,
  type MyDetailsValues,
} from '../schemas';

const LANGUAGE_OPTIONS = optionsOf(PATIENT_LANGUAGES, LANGUAGE_LABELS);

function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className="mt-0.5 font-medium">{value}</dd>
    </div>
  );
}

/** Identity fields only reception may change. */
function IdentityCard({ patient: p }: { patient: Patient }) {
  return (
    <Card title="My record">
      <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <ReadOnly label="Patient number (MRN)" value={p.mrn} />
        <ReadOnly label="Name" value={p.fullName} />
        <ReadOnly label="Date of birth" value={formatCalendarDate(p.dateOfBirth)} />
        <ReadOnly label="Gender" value={GENDER_LABELS[p.gender]} />
        <ReadOnly label="Blood group" value={BLOOD_GROUP_LABELS[p.bloodGroup]} />
      </dl>
      <p className="mt-4 text-xs text-slate-500">
        Contact reception to change your name, date of birth, gender or blood group.
      </p>
    </Card>
  );
}

/** Editable contact details, address, emergency contact and language. */
function ContactForm({ patient }: { patient: Patient }) {
  const [update, { isLoading: saving }] = useUpdateMyPatientMutation();
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isDirty },
  } = useForm<MyDetailsValues>({
    resolver: zodResolver(myDetailsSchema),
    defaultValues: myDetailsToForm(patient),
  });
  const leaveGuard = useUnsavedChanges(isDirty && !saving);

  const onSubmit = handleSubmit(async (values) => {
    try {
      const saved = await update(toMyDetailsBody(values)).unwrap();
      reset(myDetailsToForm(saved));
      toast.success('Your details were saved');
    } catch (err) {
      if (!applyServerFieldErrorsByPath(err, setError, (path) => path)) {
        setError('root', { message: getQueryErrorMessage(err) });
      }
    }
  });

  return (
    <Card title="Contact details">
      <form noValidate onSubmit={onSubmit} className="space-y-4">
        {errors.root && <Alert tone="error">{errors.root.message}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Mobile number"
            type="tel"
            autoComplete="tel"
            error={errors.phone?.message}
            {...register('phone')}
          />
          <Input
            label="Email"
            type="email"
            autoComplete="email"
            hint="For appointment reminders. Your login email does not change."
            error={errors.email?.message}
            {...register('email')}
          />
          <Input
            label="Address line 1"
            className="sm:col-span-2"
            autoComplete="address-line1"
            error={errors.address?.line1?.message}
            {...register('address.line1')}
          />
          <Input
            label="Address line 2"
            className="sm:col-span-2"
            autoComplete="address-line2"
            error={errors.address?.line2?.message}
            {...register('address.line2')}
          />
          <Input label="City" autoComplete="address-level2" {...register('address.city')} />
          <Input label="State" autoComplete="address-level1" {...register('address.state')} />
          <Input
            label="PIN code"
            inputMode="numeric"
            autoComplete="postal-code"
            {...register('address.postalCode')}
          />
          <Input label="Country" autoComplete="country-name" {...register('address.country')} />
        </div>
        <fieldset className="grid gap-4 border-t border-slate-100 pt-4 sm:grid-cols-3">
          <legend className="mb-2 text-sm font-semibold text-slate-700">Emergency contact</legend>
          <Input label="Contact name" {...register('emergencyContact.name')} />
          <Input label="Relation" {...register('emergencyContact.relation')} />
          <Input
            label="Contact phone"
            type="tel"
            error={errors.emergencyContact?.phone?.message}
            {...register('emergencyContact.phone')}
          />
        </fieldset>
        <Select
          label="Preferred language"
          options={LANGUAGE_OPTIONS}
          className="sm:max-w-xs"
          {...register('preferredLanguage')}
        />
        <div className="flex justify-end">
          <Button type="submit" loading={saving} disabled={!isDirty}>
            Save details
          </Button>
        </div>
      </form>
      {leaveGuard}
    </Card>
  );
}

/** Consent switches; each change is saved at once. Turning AI off asks first. */
function ConsentCard({ patient }: { patient: Patient }) {
  const [update, { isLoading }] = useUpdateMyPatientMutation();
  const [confirmAiOff, setConfirmAiOff] = useState(false);
  const { consent } = patient;

  const save = async (body: NonNullable<MyDetailsBody['consent']>, done: string) => {
    try {
      await update({ consent: body }).unwrap();
      toast.success(done);
    } catch (err) {
      toast.error(getQueryErrorMessage(err));
    }
  };

  return (
    <Card title="Consent and communication">
      <div className="space-y-4">
        <Switch
          label="AI explanations"
          description="Plain-language explanations of your prescriptions and lab reports, written by AI and checked for safety. They never replace your doctor's advice."
          checked={consent.aiExplanations.given}
          disabled={isLoading}
          onChange={(on) =>
            on
              ? void save({ aiExplanations: true }, 'AI explanations turned on')
              : setConfirmAiOff(true)
          }
        />
        <Switch
          label="Email reminders"
          description="Appointment reminders and notices by email."
          checked={consent.communications.email}
          disabled={isLoading}
          onChange={(on) => void save({ communications: { email: on } }, 'Preference saved')}
        />
        <Switch
          label="SMS reminders"
          checked={consent.communications.sms}
          disabled={isLoading}
          onChange={(on) => void save({ communications: { sms: on } }, 'Preference saved')}
        />
        <p className="text-xs text-slate-500">
          You agreed to the clinic processing your data to provide care
          {consent.dataProcessing.at ? ` on ${formatDate(consent.dataProcessing.at)}` : ''}. To
          withdraw it, please contact the clinic.
        </p>
      </div>
      <ConfirmDialog
        open={confirmAiOff}
        title="Turn off AI explanations?"
        confirmLabel="Turn off"
        loading={isLoading}
        onCancel={() => setConfirmAiOff(false)}
        onConfirm={() => {
          setConfirmAiOff(false);
          void save({ aiExplanations: false }, 'AI explanations turned off');
        }}
      >
        You will no longer be offered plain-language AI explanations of your prescriptions and lab
        reports. Your doctor's notes and reports stay available as they are, and you can turn this
        back on at any time.
      </ConfirmDialog>
    </Card>
  );
}

/** Allergies and chronic conditions, read-only. */
function HealthCard({ patient: p }: { patient: Patient }) {
  return (
    <Card title="Allergies and conditions">
      <p className="mb-3 text-xs text-slate-500">
        Recorded by your clinic. Tell your doctor or reception if anything is missing or wrong.
      </p>
      <h3 className="mb-2 text-sm font-semibold text-slate-700">Allergies</h3>
      <AllergyChips allergies={p.allergies ?? []} />
      <h3 className="mt-4 mb-2 text-sm font-semibold text-slate-700">Long-term conditions</h3>
      {(p.chronicConditions ?? []).length === 0 ? (
        <p className="text-sm text-slate-500">None recorded.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {p.chronicConditions!.map((c) => (
            <li key={c.id}>
              <span className="font-medium">{c.name}</span>
              {c.since && (
                <span className="text-slate-500"> · since {formatCalendarDate(c.since)}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** /patient/profile – the patient's own record (spec §7.7 /patients/me). */
export default function MyPatientProfilePage() {
  const { data: patient, isLoading, isError, error, refetch } = useGetMyPatientQuery();

  if (isLoading) {
    return (
      <section className="mx-auto w-full max-w-4xl">
        <ListSkeleton label="Loading your details…" rows={3} />
      </section>
    );
  }
  if (isError || !patient) {
    const pending = isApiQueryError(error) && error.code === 'PATIENT_LINK_PENDING';
    return (
      <section className="mx-auto w-full max-w-4xl space-y-4">
        <PageHeader title="My details" />
        {pending ? (
          <Alert tone="warning" title="Waiting for the clinic to confirm your identity">
            {getQueryErrorMessage(error)}{' '}
            <Link to={VERIFY_IDENTITY_PATH} className="font-medium underline">
              What to bring
            </Link>
          </Alert>
        ) : (
          <ErrorState error={error} onRetry={() => void refetch()} />
        )}
      </section>
    );
  }

  return (
    <section className="mx-auto w-full max-w-4xl space-y-4">
      <PageHeader title="My details" description="Your patient record at the clinic." />
      <IdentityCard patient={patient} />
      <ContactForm patient={patient} />
      <ConsentCard patient={patient} />
      <HealthCard patient={patient} />
    </section>
  );
}
