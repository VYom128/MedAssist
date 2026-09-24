import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { FormProvider, get, useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import Alert from '../../../components/ui/Alert';
import Button from '../../../components/ui/Button';
import ErrorState from '../../../components/ui/ErrorState';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import PageHeader from '../../../components/ui/PageHeader';
import Tabs from '../../../components/ui/Tabs';
import { useUnsavedChanges } from '../../../hooks/useUnsavedChanges';
import { formatDateTime } from '../../../utils/dates';
import { applyServerFieldErrors } from '../../../utils/forms';
import { getQueryErrorMessage } from '../../../utils/http';
import { useGetSettingsQuery, useUpdateSettingsMutation, type AdminSettings } from '../api';
import {
  AiSection,
  AppointmentsSection,
  BillingSection,
  ClinicSection,
  LabSection,
  NotificationsSection,
} from '../components/SettingsSections';
import {
  ALL_FIELDS,
  buildPatch,
  settingsSchema,
  TAB_FIELDS,
  toFormValues,
  type SettingsFormInput,
  type SettingsFormValues,
  type SettingsTab,
} from '../schemas';

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'clinic', label: 'Clinic' },
  { id: 'appointments', label: 'Appointments' },
  { id: 'billing', label: 'Billing' },
  { id: 'lab', label: 'Lab' },
  { id: 'ai', label: 'AI' },
  { id: 'notifications', label: 'Notifications' },
];

const SECTIONS: Record<SettingsTab, () => React.JSX.Element> = {
  clinic: ClinicSection,
  appointments: AppointmentsSection,
  billing: BillingSection,
  lab: LabSection,
  ai: AiSection,
  notifications: NotificationsSection,
};

/** /admin/settings – clinic settings in tabs (spec §13.4 item 8). */
export default function SettingsPage() {
  const { data, isLoading, isError, error, refetch } = useGetSettingsQuery();
  return (
    <section className="mx-auto w-full max-w-form">
      <PageHeader
        title="Clinic settings"
        description={
          data?.updatedAt
            ? `Last changed ${formatDateTime(data.updatedAt)}`
            : 'How the clinic runs.'
        }
      />
      {isLoading && <ListSkeleton label="Loading settings…" rows={6} />}
      {isError && <ErrorState error={error} onRetry={() => void refetch()} />}
      {data && <SettingsForm settings={data} />}
    </section>
  );
}

function SettingsForm({ settings }: { settings: AdminSettings }) {
  const [tab, setTab] = useState<SettingsTab>('clinic');
  const [updateSettings, { isLoading: saving }] = useUpdateSettingsMutation();
  const form = useForm<SettingsFormInput, unknown, SettingsFormValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: toFormValues(settings),
    mode: 'onBlur',
  });
  const {
    handleSubmit,
    reset,
    setError,
    formState: { isDirty, dirtyFields, errors },
  } = form;
  const leaveDialog = useUnsavedChanges(isDirty && !saving);

  // Settings changed elsewhere (another tab or admin): take them if nothing is being edited.
  useEffect(() => {
    if (!isDirty) reset(toFormValues(settings));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the server copy changes
  }, [settings]);

  const tabHasError = (id: SettingsTab) => TAB_FIELDS[id].some((f) => get(errors, f));
  // Runs after a failed submit: reads the current errors (not this render's snapshot).
  const showFirstErrorTab = () => {
    const first = TABS.find((t) =>
      TAB_FIELDS[t.id].some((f) => form.getFieldState(f as keyof SettingsFormInput).error),
    );
    if (first) setTab(first.id);
  };

  const onSubmit = handleSubmit(
    async (values) => {
      try {
        const updated = await updateSettings(buildPatch(values, dirtyFields)).unwrap();
        reset(toFormValues(updated));
        toast.success('Settings saved');
      } catch (err) {
        const applied = applyServerFieldErrors(err, setError, ALL_FIELDS, {
          'billing.defaultTaxRateBps': 'billing.defaultTaxRatePercent',
        });
        if (applied) {
          // Errors are set synchronously; switch to the first tab that has one.
          setTimeout(showFirstErrorTab);
        } else {
          setError('root', { message: getQueryErrorMessage(err) });
        }
      }
    },
    () => setTimeout(showFirstErrorTab),
  );

  const Section = SECTIONS[tab];
  return (
    <FormProvider {...form}>
      <form onSubmit={onSubmit} noValidate>
        <Tabs
          variant="pills"
          label="Settings sections"
          tabs={TABS.map((t) => ({ ...t, alert: tabHasError(t.id) }))}
          value={tab}
          onChange={(id) => setTab(id as SettingsTab)}
        >
          {errors.root && (
            <div className="mb-4">
              <Alert tone="error">{errors.root.message}</Alert>
            </div>
          )}
          <Section />
        </Tabs>
        <div className="sticky bottom-0 z-10 -mx-4 mt-6 flex flex-col-reverse gap-2 border-t border-line bg-surface/90 px-4 py-3 backdrop-blur-md sm:mx-0 sm:flex-row sm:items-center sm:justify-end sm:rounded-card sm:border sm:shadow-card-hover">
          {isDirty && (
            <p className="flex items-center gap-2 text-sm font-medium text-warning-700 sm:mr-auto">
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-warning-500" />
              You have unsaved changes.
            </p>
          )}
          <Button
            variant="secondary"
            disabled={!isDirty || saving}
            onClick={() => reset(toFormValues(settings))}
          >
            Discard changes
          </Button>
          <Button type="submit" disabled={!isDirty} loading={saving}>
            Save changes
          </Button>
        </div>
      </form>
      {leaveDialog}
    </FormProvider>
  );
}
