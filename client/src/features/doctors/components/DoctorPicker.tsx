import Select from '../../../components/ui/Select';
import { useListDepartmentsQuery } from '../../departments/api';
import { useListDoctorsQuery, type Doctor } from '../api';

/**
 * Department, then doctor (active doctors taking appointments). Changing the department clears a
 * doctor from another department. `allowAll` adds an "All …" choice (filters).
 */
export default function DoctorPicker({
  departmentId,
  doctorId,
  onDepartmentChange,
  onDoctorChange,
  doctorError,
  allowAll = false,
  className = '',
}: {
  departmentId: string;
  doctorId: string;
  onDepartmentChange: (id: string) => void;
  onDoctorChange: (id: string, doctor: Doctor | undefined) => void;
  doctorError?: string;
  allowAll?: boolean;
  className?: string;
}) {
  const departments = useListDepartmentsQuery({ limit: 100 });
  const doctors = useListDoctorsQuery({
    limit: 100,
    accepting: allowAll ? undefined : true,
    ...(departmentId ? { department: departmentId } : {}),
  });
  const doctorOptions = (doctors.data?.items ?? []).map((d) => ({
    value: d.id,
    label: `${d.name}${d.specialization ? ` – ${d.specialization}` : ''}`,
  }));

  return (
    <div className={`grid gap-4 sm:grid-cols-2 ${className}`}>
      <Select
        label="Department"
        placeholder={allowAll ? 'All departments' : 'Any department'}
        options={(departments.data?.items ?? []).map((d) => ({ value: d.id, label: d.name }))}
        value={departmentId}
        onChange={(e) => {
          onDepartmentChange(e.target.value);
          const current = doctors.data?.items.find((d) => d.id === doctorId);
          if (current && e.target.value && current.department?.id !== e.target.value) {
            onDoctorChange('', undefined);
          }
        }}
      />
      <Select
        label="Doctor"
        placeholder={
          doctors.isLoading ? 'Loading doctors…' : allowAll ? 'All doctors' : 'Choose a doctor'
        }
        options={doctorOptions}
        value={doctorId}
        error={doctorError}
        onChange={(e) =>
          onDoctorChange(
            e.target.value,
            doctors.data?.items.find((d) => d.id === e.target.value),
          )
        }
      />
    </div>
  );
}
