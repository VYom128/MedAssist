import { BellRing, HeartPulse, Phone } from 'lucide-react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Link } from 'react-router-dom';
import { VERIFY_IDENTITY_PATH } from '../../../routes/home';
import Alert from '../../../components/ui/Alert';
import Avatar from '../../../components/ui/Avatar';
import Button from '../../../components/ui/Button';
import Code from '../../../components/ui/Code';
import ConfirmDialog from '../../../components/ui/ConfirmDialog';
import DescriptionList from '../../../components/ui/DescriptionList';
import ErrorState from '../../../components/ui/ErrorState';
import FormSection from '../../../components/ui/FormSection';
import Input from '../../../components/ui/Input';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import PageHeader from '../../../components/ui/PageHeader';
import SectionCard from '../../../components/ui/SectionCard';
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

/** Identity fields only reception may change, as a header card. */
function IdentityCard({ patient: p }: { patient: Patient }) {
  return (
    <section
      aria-labelledby="my-record-title"
      className="rounded-card border border-line bg-surface p-5 shadow-card lg:p-6"
    >
      <h2 id="my-record-title" className="sr-only">
        My record
      </h2>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <Avatar name={p.fullName} size="xl" />
        <div className="min-w-0 flex-1">
          <p className="text-section break-words">{p.fullName}</p>
          <div className="mt-2">
            <DescriptionList
              columns={3}
              items={[
                { label: 'Patient number (MRN)', value: <Code>{p.mrn}</Code> },
                { label: 'Name', value: p.fullName },
                { label: 'Date of birth', value: formatCalendarDate(p.dateOfBirth) },
                { label: 'Gender', value: GENDER_LABELS[p.gender] },
                { label: 'Blood group', value: BLOOD_GROUP_LABELS[p.bloodGroup] },
              ]}
            />
          </div>
        </div>
      </div>
      <p className="mt-4 border-t border-line pt-3 text-xs text-muted">
        Contact reception to change your name, date of birth, gender or blood group.
      </p>
    </section>
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
    <form noValidate onSubmit={onSubmit}>
      <SectionCard
        title="Contact details"
        description="How the clinic reaches you, and who to call in an emergency."
        icon={Phone}
        footer={
          <Button type="submit" loading={saving} disabled={!isDirty}>
            Save details
          </Button>
        }
      >
        <div className="space-y-6">
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
          <FormSection title="Emergency contact" className="border-t border-line pt-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <Input label="Contact name" {...register('emergencyContact.name')} />
              <Input label="Relation" {...register('emergencyContact.relation')} />
              <Input
                label="Contact phone"
                type="tel"
                error={errors.emergencyContact?.phone?.message}
                {...register('emergencyContact.phone')}
              />
            </div>
          </FormSection>
          <FormSection title="Language" className="border-t border-line pt-5">
            <Select
              label="Preferred language"
              options={LANGUAGE_OPTIONS}
              className="sm:max-w-xs"
              {...register('preferredLanguage')}
            />
          </FormSection>
        </div>
      </SectionCard>
      {leaveGuard}
    </form>
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
    <SectionCard
      title="Consent and communication"
      description="Each change is saved straight away."
      icon={BellRing}
    >
      <div className="space-y-5 divide-line [&>*+*]:border-t [&>*+*]:pt-5">
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
        <p className="text-xs text-muted">
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
    </SectionCard>
  );
}

/** Allergies and chronic conditions, read-only. */
function HealthCard({ patient: p }: { patient: Patient }) {
  return (
    <SectionCard
      title="Allergies and conditions"
      description="Recorded by your clinic. Tell your doctor or reception if anything is missing or wrong."
      icon={HeartPulse}
      iconTone="danger"
    >
      <h3 className="mb-2 text-caption text-muted uppercase">Allergies</h3>
      <AllergyChips allergies={p.allergies ?? []} />
      <h3 className="mt-5 mb-2 text-caption text-muted uppercase">Long-term conditions</h3>
      {(p.chronicConditions ?? []).length === 0 ? (
        <p className="text-sm text-muted">None recorded.</p>
      ) : (
        <ul aria-label="Long-term conditions" className="flex flex-wrap gap-1.5">
          {p.chronicConditions!.map((c) => (
            <li
              key={c.id}
              className="inline-flex items-center gap-1 rounded-full bg-neutral-50 px-2.5 py-1 text-xs font-semibold text-neutral-700 ring-1 ring-neutral-100 ring-inset"
            >
              {c.name}
              {c.since && (
                <span className="font-normal"> · since {formatCalendarDate(c.since)}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

/** /patient/profile – the patient's own record (spec §7.7 /patients/me). */
export default function MyPatientProfilePage() {
  const { data: patient, isLoading, isError, error, refetch } = useGetMyPatientQuery();

  if (isLoading) {
    return (
      <section className="mx-auto w-full max-w-5xl">
        <ListSkeleton label="Loading your details…" rows={3} />
      </section>
    );
  }
  if (isError || !patient) {
    const pending = isApiQueryError(error) && error.code === 'PATIENT_LINK_PENDING';
    return (
      <section className="mx-auto w-full max-w-5xl">
        <PageHeader title="My details" />
        {pending ? (
          <Alert tone="warning" title="Waiting for the clinic to confirm your identity">
            {getQueryErrorMessage(error)}{' '}
            <Link to={VERIFY_IDENTITY_PATH} className="rounded font-semibold underline">
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
    <section className="mx-auto w-full max-w-5xl">
      <PageHeader title="My details" description="Your patient record at the clinic." />
      <div className="space-y-6">
        <IdentityCard patient={patient} />
        <HealthCard patient={patient} />
        <ContactForm patient={patient} />
        <ConsentCard patient={patient} />
      </div>
    </section>
  );
}
