import {
  Bell,
  Building2,
  CalendarClock,
  CalendarCog,
  Clock,
  FlaskConical,
  MapPin,
  Phone,
  Power,
  Receipt,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Controller, get, useFormContext, type FieldPath } from 'react-hook-form';
import FilterChip from '../../../components/ui/FilterChip';
import Input from '../../../components/ui/Input';
import SearchableSelect from '../../../components/ui/SearchableSelect';
import SectionCard from '../../../components/ui/SectionCard';
import Switch from '../../../components/ui/Switch';
import Textarea from '../../../components/ui/Textarea';
import {
  EXPLANATION_LANGUAGES,
  LANGUAGE_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  WEEK_ORDER,
  WEEKDAY_NAMES,
  WEEKDAY_SHORT,
} from '../../../constants/catalog';
import { timezoneOptions, type SettingsFormInput } from '../schemas';

type Path = FieldPath<SettingsFormInput>;

function useField() {
  const {
    register,
    formState: { errors },
  } = useFormContext<SettingsFormInput>();
  const error = (path: Path) => get(errors, path)?.message as string | undefined;
  return {
    text: (path: Path) => ({ ...register(path), error: error(path) }),
    number: (path: Path) => ({
      ...register(path, { valueAsNumber: true }),
      type: 'number',
      inputMode: 'numeric' as const,
      error: error(path),
    }),
    error,
  };
}

/** One settings card: title, one-line description, then its fields. */
function Fieldset({
  legend,
  description,
  icon,
  tone = 'default',
  children,
}: {
  legend: string;
  description?: string;
  icon?: LucideIcon;
  /** `critical` marks a switch with wide effect (the AI kill switch). */
  tone?: 'default' | 'critical';
  children: ReactNode;
}) {
  return (
    <SectionCard
      title={legend}
      description={description}
      icon={icon}
      iconTone={tone === 'critical' ? 'warning' : 'primary'}
      className={tone === 'critical' ? 'border-warning-100 bg-warning-50/40' : ''}
      bodyClassName="space-y-5"
    >
      {children}
    </SectionCard>
  );
}

/** Toggle buttons for a set of values (working days, payment methods, languages). */
function ToggleGroup<T extends string | number>({
  name,
  label,
  options,
}: {
  name: Path;
  label: string;
  options: readonly { value: T; label: string; title?: string }[];
}) {
  const { control } = useFormContext<SettingsFormInput>();
  const { error } = useField();
  const message = error(name);
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => {
        const selected = (field.value as T[]) ?? [];
        const toggle = (v: T) =>
          field.onChange(selected.includes(v) ? selected.filter((s) => s !== v) : [...selected, v]);
        return (
          <div role="group" aria-label={label}>
            <p className="text-sm font-medium text-ink">{label}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {options.map((o) => (
                <FilterChip
                  key={String(o.value)}
                  label={o.label}
                  title={o.title}
                  selected={selected.includes(o.value)}
                  onClick={() => toggle(o.value)}
                />
              ))}
            </div>
            {message && <p className="mt-1.5 text-sm text-danger-700">{message}</p>}
          </div>
        );
      }}
    />
  );
}

function SwitchField({
  name,
  label,
  description,
}: {
  name: Path;
  label: string;
  description?: string;
}) {
  const { control } = useFormContext<SettingsFormInput>();
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <Switch
          label={label}
          description={description}
          checked={Boolean(field.value)}
          onChange={field.onChange}
        />
      )}
    />
  );
}

export function ClinicSection() {
  const f = useField();
  return (
    <div className="space-y-6">
      <Fieldset
        legend="Clinic"
        description="The clinic's name and registration details."
        icon={Building2}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Clinic name" {...f.text('name')} />
          <Input label="Tagline" {...f.text('tagline')} />
          <Input label="Logo URL" type="url" placeholder="https://…" {...f.text('logoUrl')} />
          <Input label="Registration number" {...f.text('registrationNumber')} />
          <Input label="GSTIN" {...f.text('gstin')} />
        </div>
      </Fieldset>
      <Fieldset legend="Address" icon={MapPin}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Address line 1" {...f.text('address.line1')} />
          <Input label="Address line 2" {...f.text('address.line2')} />
          <Input label="City" {...f.text('address.city')} />
          <Input label="State" {...f.text('address.state')} />
          <Input label="Postal code" inputMode="numeric" {...f.text('address.postalCode')} />
          <Input label="Country" {...f.text('address.country')} />
        </div>
      </Fieldset>
      <Fieldset legend="Contact" icon={Phone}>
        <div className="grid gap-4 sm:grid-cols-3">
          <Input label="Phone" type="tel" {...f.text('phone')} />
          <Input label="Email" type="email" {...f.text('email')} />
          <Input label="Website" type="url" placeholder="https://…" {...f.text('website')} />
        </div>
      </Fieldset>
      <Fieldset
        legend="Region and hours"
        description="Timezone, currency and the days the clinic is open."
        icon={Clock}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <SearchableSelect
            label="Timezone"
            options={timezoneOptions()}
            hint="All dates and schedules use this timezone. Changing it changes how existing times are shown."
            {...f.text('timezone')}
          />
          <Input label="Currency" maxLength={3} {...f.text('currency')} />
        </div>
        <ToggleGroup
          name="workingDays"
          label="Working days"
          options={WEEK_ORDER.map((d) => ({
            value: d,
            label: WEEKDAY_SHORT[d],
            title: WEEKDAY_NAMES[d],
          }))}
        />
      </Fieldset>
    </div>
  );
}

export function AppointmentsSection() {
  const f = useField();
  return (
    <div className="space-y-6">
      <Fieldset
        legend="Appointment rules"
        description="Slot length, how far ahead people can book, and cancellation limits."
        icon={CalendarCog}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Default slot length (minutes)"
            {...f.number('appointment.defaultSlotMinutes')}
          />
          <Input
            label="Booking window (days ahead)"
            hint="How far ahead patients can book."
            {...f.number('appointment.bookingWindowDays')}
          />
          <Input
            label="Cancel / reschedule up to (hours before)"
            {...f.number('appointment.minCancelHours')}
          />
          <Input
            label="Active bookings per patient"
            {...f.number('appointment.maxActiveBookingsPerPatient')}
          />
          <Input
            label="Walk-in overbook per session"
            {...f.number('appointment.walkInOverbookPerSession')}
          />
          <Input
            label="No-show after (minutes past slot end)"
            {...f.number('appointment.noShowGraceMinutes')}
          />
          <Input label="Reminder (hours before)" {...f.number('appointment.reminderHoursBefore')} />
        </div>
      </Fieldset>
      <Fieldset legend="Online booking" icon={CalendarClock}>
        <SwitchField
          name="appointment.allowPatientSelfBooking"
          label="Patients can book online"
          description="When off, only reception can book appointments."
        />
      </Fieldset>
    </div>
  );
}

export function BillingSection() {
  const f = useField();
  return (
    <Fieldset
      legend="Billing"
      description="Invoice numbering, tax and accepted payment methods."
      icon={Receipt}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Invoice prefix" maxLength={6} {...f.text('billing.invoicePrefix')} />
        <Input label="Tax label" {...f.text('billing.taxLabel')} />
        <Input
          label="Default tax rate (%)"
          step="0.01"
          hint="Used when a service has no rate of its own."
          {...f.number('billing.defaultTaxRatePercent')}
          inputMode="decimal"
        />
        <Input
          label="Max discount without admin (%)"
          {...f.number('billing.maxDiscountPercentWithoutAdmin')}
        />
      </div>
      <ToggleGroup
        name="billing.paymentMethods"
        label="Payment methods"
        options={PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] }))}
      />
      <Textarea label="Invoice footer" {...f.text('billing.invoiceFooter')} />
    </Fieldset>
  );
}

export function LabSection() {
  return (
    <Fieldset legend="Lab" description="How results are checked and flagged." icon={FlaskConical}>
      <SwitchField
        name="lab.requireDualVerification"
        label="Second lab technician verifies results"
        description="The person who entered results cannot verify them. Turn off if you have one lab technician."
      />
      <div className="border-t border-line pt-5">
        <SwitchField
          name="lab.criticalAlertEnabled"
          label="Alert the doctor about critical values"
        />
      </div>
    </Fieldset>
  );
}

export function AiSection() {
  return (
    <div className="space-y-6">
      <Fieldset
        legend="Master switch"
        description="Switch this off to stop every AI feature at once. Each feature below can also be switched off on its own."
        icon={Power}
        tone="critical"
      >
        <SwitchField
          name="ai.enabled"
          label="AI features"
          description="Turns every AI feature off when off."
        />
      </Fieldset>
      <Fieldset
        legend="AI features"
        description="AI never diagnoses or changes treatment. Doctors approve every clinical summary."
        icon={Sparkles}
      >
        <SwitchField name="ai.clinicalSummaryEnabled" label="Clinical summaries for doctors" />
        <div className="border-t border-line pt-5">
          <SwitchField
            name="ai.patientExplanationEnabled"
            label="Plain-language explanations for patients"
          />
        </div>
        <ToggleGroup
          name="ai.explanationLanguages"
          label="Explanation languages"
          options={EXPLANATION_LANGUAGES.map((l) => ({ value: l, label: LANGUAGE_LABELS[l] }))}
        />
      </Fieldset>
    </div>
  );
}

export function NotificationsSection() {
  return (
    <Fieldset legend="Notifications" icon={Bell}>
      <SwitchField
        name="notifications.emailEnabled"
        label="Email notifications"
        description="In-app notifications are always on. Emails never include clinical details."
      />
    </Fieldset>
  );
}
