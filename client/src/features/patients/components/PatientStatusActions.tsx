import { UserCheck, UserX } from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import Button from '../../../components/ui/Button';
import { getQueryErrorMessage } from '../../../utils/http';
import { useSetPatientActiveMutation, type Patient } from '../api';
import ReasonDialog from '../../../components/ui/ReasonDialog';

/** Admin: deactivate / reactivate a patient record, with a reason (audited). */
export default function PatientStatusActions({ patient }: { patient: Patient }) {
  const [setActive, { isLoading }] = useSetPatientActiveMutation();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const action = patient.isActive ? 'deactivate' : 'activate';

  const submit = async (reason: string) => {
    setError(null);
    try {
      await setActive({ id: patient.id, action, reason }).unwrap();
      toast.success(`${patient.fullName} ${patient.isActive ? 'deactivated' : 'reactivated'}`);
      setOpen(false);
    } catch (err) {
      setError(getQueryErrorMessage(err));
    }
  };

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {patient.isActive ? (
          <UserX className="h-4 w-4" aria-hidden="true" />
        ) : (
          <UserCheck className="h-4 w-4" aria-hidden="true" />
        )}
        {patient.isActive ? 'Deactivate' : 'Reactivate'}
      </Button>
      <ReasonDialog
        open={open}
        title={patient.isActive ? 'Deactivate patient?' : 'Reactivate patient?'}
        confirmLabel={patient.isActive ? 'Deactivate' : 'Reactivate'}
        tone={patient.isActive ? 'danger' : 'primary'}
        minLength={5}
        loading={isLoading}
        error={error}
        onCancel={() => {
          setOpen(false);
          setError(null);
        }}
        onSubmit={(reason) => void submit(reason)}
      >
        {patient.isActive
          ? 'The record is hidden from reception searches. Nothing is deleted.'
          : 'The record appears in searches again.'}
      </ReasonDialog>
    </>
  );
}
