import {
  HeartPulse,
  Languages,
  Phone,
  Plus,
  ShieldCheck,
  Siren,
  Trash2,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Controller, useFieldArray, useWatch, type UseFormReturn } from 'react-hook-form';
import Button from '../../../components/ui/Button';
import SectionCard from '../../../components/ui/SectionCard';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Switch from '../../../components/ui/Switch';
import Textarea from '../../../components/ui/Textarea';
import {
  ALLERGY_SEVERITIES,
  BLOOD_GROUP_LABELS,
  BLOOD_GROUPS,
  GENDER_LABELS,
  GENDERS,
  LANGUAGE_LABELS,
  PATIENT_LANGUAGES,
  optionsOf,
} from '../../../constants/catalog';
import { ageOn } from '../../../utils/dates';
import { dateOfBirthProblem, maxBirthDate, type PatientFormValues } from '../schemas';

const GENDER_OPTIONS = optionsOf(GENDERS, GENDER_LABELS);
const BLOOD_OPTIONS = optionsOf(BLOOD_GROUPS, BLOOD_GROUP_LABELS);
const LANGUAGE_OPTIONS = optionsOf(PATIENT_LANGUAGES, LANGUAGE_LABELS);
const SEVERITY_OPTIONS = optionsOf(ALLERGY_SEVERITIES);

function Section({
  title,
  description,
  icon,
  children,
}: {
  title: string;
  description?: string;
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <SectionCard title={title} description={description} icon={icon}>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </SectionCard>
  );
}

/**
 * The patient form's sections (spec §4.3 step 3), shared by the new-patient page and edit mode.
 * Allergies are only for receptionists; consent only when registering.
 */
export default function PatientFormSections({
  form,
  showAllergies,
  showConsent,
  afterContact,
}: {
  form: UseFormReturn<PatientFormValues>;
  showAllergies: boolean;
  showConsent: boolean;
  /** Rendered after the contact section (the duplicate panel). */
  afterContact?: ReactNode;
}) {
  const {
    register,
    control,
    formState: { errors },
  } = form;
  const allergies = useFieldArray({ control, name: 'allergies' });
  const dob = useWatch({ control, name: 'dateOfBirth' });
  const age = dob && !dateOfBirthProblem(dob) ? ageOn(dob) : null;

  return (
    <div className="space-y-6">
      <Section title="Demographics" description="Name, date of birth and sex." icon={UserRound}>
        <Input
          label="First name"
          autoComplete="off"
          error={errors.firstName?.message}
          {...register('firstName')}
        />
        <Input
          label="Last name"
          autoComplete="off"
          error={errors.lastName?.message}
          {...register('lastName')}
        />
        <Input
          label="Date of birth"
          type="date"
          max={maxBirthDate()}
          hint={age !== null ? `Age: ${age} ${age === 1 ? 'year' : 'years'}` : undefined}
          error={errors.dateOfBirth?.message}
          {...register('dateOfBirth')}
        />
        <Select
          label="Gender"
          placeholder="Choose…"
          options={GENDER_OPTIONS}
          error={errors.gender?.message}
          {...register('gender')}
        />
        <Select label="Blood group" options={BLOOD_OPTIONS} {...register('bloodGroup')} />
      </Section>

      <Section
        title="Contact"
        description="The mobile number is also used to find the patient."
        icon={Phone}
      >
        <Input
          label="Mobile number"
          type="tel"
          autoComplete="off"
          hint="Numbers without a country code are Indian (+91)."
          error={errors.phone?.message}
          {...register('phone')}
        />
        <Input
          label="Email (optional)"
          type="email"
          autoComplete="off"
          hint="Needed to invite the patient to the portal."
          error={errors.email?.message}
          {...register('email')}
        />
        <Input
          label="Address line 1"
          className="sm:col-span-2"
          error={errors.address?.line1?.message}
          {...register('address.line1')}
        />
        <Input
          label="Address line 2"
          className="sm:col-span-2"
          error={errors.address?.line2?.message}
          {...register('address.line2')}
        />
        <Input label="City" error={errors.address?.city?.message} {...register('address.city')} />
        <Input
          label="State"
          error={errors.address?.state?.message}
          {...register('address.state')}
        />
        <Input
          label="PIN code"
          inputMode="numeric"
          error={errors.address?.postalCode?.message}
          {...register('address.postalCode')}
        />
        <Input
          label="Country"
          error={errors.address?.country?.message}
          {...register('address.country')}
        />
      </Section>

      {afterContact}

      <Section title="Emergency contact" icon={Siren}>
        <Input
          label="Contact name"
          error={errors.emergencyContact?.name?.message}
          {...register('emergencyContact.name')}
        />
        <Input
          label="Relation"
          placeholder="Spouse, parent…"
          error={errors.emergencyContact?.relation?.message}
          {...register('emergencyContact.relation')}
        />
        <Input
          label="Contact phone"
          type="tel"
          error={errors.emergencyContact?.phone?.message}
          {...register('emergencyContact.phone')}
        />
      </Section>

      {showAllergies && (
        <SectionCard
          title="Allergies"
          description="Medicines, foods or anything else the patient reacts to."
          icon={HeartPulse}
          iconTone="danger"
          actions={
            <Button
              variant="soft"
              size="sm"
              onClick={() =>
                allergies.append({ substance: '', reaction: '', severity: '' as never })
              }
            >
              <Plus className="h-4 w-4" aria-hidden="true" /> Add allergy
            </Button>
          }
        >
          {allergies.fields.length === 0 && (
            <p className="rounded-control border border-dashed border-line-strong px-3 py-2.5 text-sm text-muted">
              No known allergies. Add any the patient reports (medicines, foods, latex…).
            </p>
          )}
          <ul className="space-y-3">
            {allergies.fields.map((field, i) => (
              <li
                key={field.id}
                className="grid gap-3 rounded-control border border-danger-100 bg-danger-50/40 p-3 sm:grid-cols-[1fr_1fr_10rem_auto] sm:items-start"
              >
                <Input
                  label={`Substance ${i + 1}`}
                  error={errors.allergies?.[i]?.substance?.message}
                  {...register(`allergies.${i}.substance`)}
                />
                <Input
                  label={`Reaction ${i + 1}`}
                  error={errors.allergies?.[i]?.reaction?.message}
                  {...register(`allergies.${i}.reaction`)}
                />
                <Select
                  label={`Severity ${i + 1}`}
                  placeholder="Choose…"
                  options={SEVERITY_OPTIONS}
                  error={errors.allergies?.[i]?.severity?.message}
                  {...register(`allergies.${i}.severity`)}
                />
                <Button
                  variant="ghost"
                  className="hover:text-danger-700 sm:mt-7"
                  aria-label={`Remove allergy ${i + 1}`}
                  onClick={() => allergies.remove(i)}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      <Section title="Insurance" description="Optional." icon={ShieldCheck}>
        <Input label="Insurer" {...register('insurance.provider')} />
        <Input label="Policy number" {...register('insurance.policyNumber')} />
        <Input label="Valid till" type="date" {...register('insurance.validTill')} />
      </Section>

      <SectionCard
        title="Language & consent"
        description="How the patient wants to hear from the clinic."
        icon={Languages}
      >
        <div className="space-y-4">
          <Select
            label="Preferred language"
            options={LANGUAGE_OPTIONS}
            className="sm:max-w-xs"
            {...register('preferredLanguage')}
          />
          <Textarea
            label="Front-desk notes (not clinical)"
            rows={2}
            hint="Visible to reception and admins only."
            error={errors.adminNotes?.message}
            {...register('adminNotes')}
          />
          {showConsent && (
            <div className="space-y-5 border-t border-line pt-5">
              <Controller
                control={control}
                name="consent.dataProcessing"
                render={({ field }) => (
                  <div>
                    <Switch
                      label="Consent to data processing (required)"
                      description="The patient agrees to the clinic storing their details to provide care."
                      checked={field.value}
                      onChange={field.onChange}
                    />
                    {errors.consent?.dataProcessing && (
                      <p className="mt-1.5 text-sm text-danger-700" role="alert">
                        {errors.consent.dataProcessing.message}
                      </p>
                    )}
                  </div>
                )}
              />
              <Controller
                control={control}
                name="consent.aiExplanations"
                render={({ field }) => (
                  <Switch
                    label="AI explanations"
                    description="Plain-language explanations of prescriptions and reports in the portal."
                    checked={field.value}
                    onChange={field.onChange}
                  />
                )}
              />
              <Controller
                control={control}
                name="consent.email"
                render={({ field }) => (
                  <Switch label="Email reminders" checked={field.value} onChange={field.onChange} />
                )}
              />
              <Controller
                control={control}
                name="consent.sms"
                render={({ field }) => (
                  <Switch label="SMS reminders" checked={field.value} onChange={field.onChange} />
                )}
              />
            </div>
          )}
        </div>
      </SectionCard>
    </div>
  );
}
