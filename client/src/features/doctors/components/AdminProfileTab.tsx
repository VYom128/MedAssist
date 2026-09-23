import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Link } from 'react-router-dom';
import StatusToggleButton from '../../../components/StatusToggleButton';
import Alert from '../../../components/ui/Alert';
import Button from '../../../components/ui/Button';
import Card from '../../../components/ui/Card';
import Switch from '../../../components/ui/Switch';
import { applyServerFieldErrors } from '../../../utils/forms';
import { getQueryErrorMessage, isApiQueryError } from '../../../utils/http';
import { useDoctorAccountActionMutation, useUpdateDoctorMutation, type Doctor } from '../api';
import {
  PROFILE_FIELDS,
  profileSchema,
  toProfileInput,
  type ProfileFormInput,
  type ProfileFormValues,
} from '../schemas';
import DoctorProfileFields from './DoctorProfileFields';

const toForm = (d: Doctor): ProfileFormInput => ({
  department: d.department?.id ?? '',
  specialization: d.specialization,
  qualifications: [...d.qualifications],
  registrationNumber: d.registrationNumber ?? '',
  experienceYears: d.experienceYears === null ? '' : String(d.experienceYears),
  consultationFeePaise: d.consultationFeePaise,
  slotMinutes: d.slotMinutes == null ? '' : String(d.slotMinutes),
  roomNumber: d.roomNumber ?? '',
  bio: d.bio ?? '',
  languages: [...d.languages],
});

/** Admin: edit every profile field, the accepting switch and the account status. */
export default function AdminProfileTab({ doctor }: { doctor: Doctor }) {
  const [update, { isLoading: saving }] = useUpdateDoctorMutation();
  const [accountAction] = useDoctorAccountActionMutation();
  const form = useForm<ProfileFormInput, unknown, ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: toForm(doctor),
  });
  const {
    handleSubmit,
    reset,
    setError,
    formState: { isDirty, errors },
  } = form;

  useEffect(() => {
    reset(toForm(doctor));
  }, [doctor, reset]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      await update({ id: doctor.id, body: toProfileInput(values) }).unwrap();
      toast.success('Profile saved');
    } catch (err) {
      if (isApiQueryError(err) && err.code === 'CONFLICT') {
        setError('registrationNumber', { message: 'Another doctor has this registration number' });
        return;
      }
      if (!applyServerFieldErrors(err, setError, PROFILE_FIELDS)) {
        setError('root', { message: getQueryErrorMessage(err) });
      }
    }
  });

  const setAccepting = async (on: boolean) => {
    try {
      await update({ id: doctor.id, body: { isAcceptingAppointments: on } }).unwrap();
      toast.success(on ? 'Now accepting appointments' : 'No longer accepting appointments');
    } catch (err) {
      toast.error(getQueryErrorMessage(err));
    }
  };

  return (
    <div className="space-y-6">
      <Card title="Availability and account">
        <div className="space-y-5">
          <Switch
            label="Accepting appointments"
            description="When off, patients and reception cannot book new appointments with this doctor."
            checked={doctor.isAcceptingAppointments}
            onChange={(on) => void setAccepting(on)}
          />
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
            <div className="text-sm">
              <p className="font-medium text-slate-700">Login account</p>
              <p className="text-slate-500">
                {doctor.email} · {doctor.phone ?? 'no phone'} ·{' '}
                <Link className="text-brand-700 underline" to={`/admin/users/${doctor.id}`}>
                  Edit name, email or phone
                </Link>
              </p>
            </div>
            <StatusToggleButton
              name={`Dr ${doctor.name}`}
              active={Boolean(doctor.isActive)}
              deactivateWarning="They are signed out, cannot log in, and are hidden from booking."
              onToggle={(action) => accountAction({ id: doctor.id, action }).unwrap()}
            />
          </div>
        </div>
      </Card>

      <Card title="Profile">
        <FormProvider {...form}>
          <form onSubmit={onSubmit} noValidate className="space-y-4">
            {errors.root && <Alert tone="error">{errors.root.message}</Alert>}
            <DoctorProfileFields currentDepartment={doctor.department} />
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="secondary"
                disabled={!isDirty || saving}
                onClick={() => reset(toForm(doctor))}
              >
                Discard changes
              </Button>
              <Button type="submit" disabled={!isDirty} loading={saving}>
                Save profile
              </Button>
            </div>
          </form>
        </FormProvider>
      </Card>
    </div>
  );
}
