import { Controller, useFormContext } from 'react-hook-form';
import FormSection from '../../../components/ui/FormSection';
import Input from '../../../components/ui/Input';
import MoneyInput from '../../../components/ui/MoneyInput';
import Select from '../../../components/ui/Select';
import TagInput from '../../../components/ui/TagInput';
import Textarea from '../../../components/ui/Textarea';
import { useListDepartmentsQuery } from '../../departments/api';
import type { ProfileFormInput } from '../schemas';

/**
 * Doctor profile fields (spec §6.8), shared by "Add doctor" (step 2) and the admin profile tab.
 * Must be inside a FormProvider whose values include the profile fields.
 */
export default function DoctorProfileFields({
  currentDepartment,
}: {
  /** Keeps an inactive current department selectable when editing. */
  currentDepartment?: { id: string; name: string } | null;
}) {
  const {
    register,
    control,
    formState: { errors },
  } = useFormContext<ProfileFormInput>();
  const departments = useListDepartmentsQuery({ limit: 100 });
  const options = (departments.data?.items ?? []).map((d) => ({ value: d.id, label: d.name }));
  if (currentDepartment && !options.some((o) => o.value === currentDepartment.id)) {
    options.push({ value: currentDepartment.id, label: `${currentDepartment.name} (inactive)` });
  }

  return (
    <div className="space-y-6">
      <FormSection title="Practice">
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Department"
            placeholder="Choose a department"
            options={options}
            error={errors.department?.message}
            {...register('department')}
          />
          <Input
            label="Specialization"
            placeholder="e.g. General Physician"
            error={errors.specialization?.message}
            {...register('specialization')}
          />
          <Input
            label="Registration number"
            hint="Medical council registration"
            error={errors.registrationNumber?.message}
            {...register('registrationNumber')}
          />
          <Input
            label="Experience (years)"
            inputMode="numeric"
            error={errors.experienceYears?.message}
            {...register('experienceYears')}
          />
        </div>
      </FormSection>
      <FormSection title="Bookings">
        <div className="grid gap-4 sm:grid-cols-3">
          <Controller
            control={control}
            name="consultationFeePaise"
            render={({ field }) => (
              <MoneyInput
                label="Consultation fee"
                hint="Optional; the service price is used when empty"
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                ref={field.ref}
                error={errors.consultationFeePaise?.message}
              />
            )}
          />
          <Input
            label="Slot length (minutes)"
            inputMode="numeric"
            hint="Empty = clinic default"
            error={errors.slotMinutes?.message}
            {...register('slotMinutes')}
          />
          <Input label="Room" error={errors.roomNumber?.message} {...register('roomNumber')} />
        </div>
      </FormSection>
      <FormSection title="About">
        <div className="grid gap-4 sm:grid-cols-2">
          <Controller
            control={control}
            name="qualifications"
            render={({ field }) => (
              <TagInput
                label="Qualifications"
                value={field.value}
                onChange={field.onChange}
                placeholder="e.g. MBBS, then Enter"
                error={errors.qualifications?.message}
              />
            )}
          />
          <Controller
            control={control}
            name="languages"
            render={({ field }) => (
              <TagInput
                label="Languages"
                value={field.value}
                onChange={field.onChange}
                maxLength={30}
                placeholder="e.g. Hindi, then Enter"
                error={errors.languages?.message}
              />
            )}
          />
        </div>
        <Textarea label="Bio" rows={4} error={errors.bio?.message} {...register('bio')} />
      </FormSection>
    </div>
  );
}
