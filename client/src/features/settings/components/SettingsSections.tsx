import type { ReactNode } from 'react';
import { Controller, get, useFormContext, type FieldPath } from 'react-hook-form';
import Input from '../../../components/ui/Input';
import SearchableSelect from '../../../components/ui/SearchableSelect';
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

function Fieldset({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-4">
      <legend className="mb-2 text-sm font-semibold text-slate-900">{legend}</legend>
      {children}
    </fieldset>
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
            <p className="text-sm font-medium text-slate-700">{label}</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {options.map((o) => {
                const on = selected.includes(o.value);
                return (
                  <button
                    key={String(o.value)}
                    type="button"
                    aria-pressed={on}
                    title={o.title}
                    onClick={() => toggle(o.value)}
                    className={`min-w-12 rounded-lg border px-3 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-brand-600 ${
                      on
                        ? 'border-brand-600 bg-brand-600 text-white'
                        : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
            {message && <p className="mt-1 text-sm text-rose-600">{message}</p>}
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
    <div className="space-y-8">
      <Fieldset legend="Clinic">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Clinic name" {...f.text('name')} />
          <Input label="Tagline" {...f.text('tagline')} />
          <Input label="Logo URL" type="url" placeholder="https://…" {...f.text('logoUrl')} />
          <Input label="Registration number" {...f.text('registrationNumber')} />
          <Input label="GSTIN" {...f.text('gstin')} />
        </div>
      </Fieldset>
      <Fieldset legend="Address">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Address line 1" {...f.text('address.line1')} />
          <Input label="Address line 2" {...f.text('address.line2')} />
          <Input label="City" {...f.text('address.city')} />
          <Input label="State" {...f.text('address.state')} />
          <Input label="Postal code" inputMode="numeric" {...f.text('address.postalCode')} />
          <Input label="Country" {...f.text('address.country')} />
        </div>
      </Fieldset>
      <Fieldset legend="Contact">
        <div className="grid gap-4 sm:grid-cols-3">
          <Input label="Phone" type="tel" {...f.text('phone')} />
          <Input label="Email" type="email" {...f.text('email')} />
          <Input label="Website" type="url" placeholder="https://…" {...f.text('website')} />
        </div>
      </Fieldset>
      <Fieldset legend="Region and hours">
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
    <Fieldset legend="Appointment rules">
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
      <SwitchField
        name="appointment.allowPatientSelfBooking"
        label="Patients can book online"
        description="When off, only reception can book appointments."
      />
    </Fieldset>
  );
}

export function BillingSection() {
  const f = useField();
  return (
    <Fieldset legend="Billing">
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
    <Fieldset legend="Lab">
      <SwitchField
        name="lab.requireDualVerification"
        label="Second lab technician verifies results"
        description="The person who entered results cannot verify them. Turn off if you have one lab technician."
      />
      <SwitchField name="lab.criticalAlertEnabled" label="Alert the doctor about critical values" />
    </Fieldset>
  );
}

export function AiSection() {
  return (
    <Fieldset legend="AI features">
      <SwitchField
        name="ai.enabled"
        label="AI features"
        description="Turns every AI feature off when off."
      />
      <SwitchField name="ai.clinicalSummaryEnabled" label="Clinical summaries for doctors" />
      <SwitchField
        name="ai.patientExplanationEnabled"
        label="Plain-language explanations for patients"
      />
      <ToggleGroup
        name="ai.explanationLanguages"
        label="Explanation languages"
        options={EXPLANATION_LANGUAGES.map((l) => ({ value: l, label: LANGUAGE_LABELS[l] }))}
      />
    </Fieldset>
  );
}

export function NotificationsSection() {
  return (
    <Fieldset legend="Notifications">
      <SwitchField
        name="notifications.emailEnabled"
        label="Email notifications"
        description="In-app notifications are always on. Emails never include clinical details."
      />
    </Fieldset>
  );
}
