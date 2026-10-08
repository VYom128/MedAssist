import { useState } from 'react';
import toast from 'react-hot-toast';
import Alert from '../../../components/ui/Alert';
import Button from '../../../components/ui/Button';
import Modal from '../../../components/ui/Modal';
import { getQueryErrorMessage } from '../../../utils/http';
import DoctorPicker from '../../doctors/components/DoctorPicker';
import { useAssignFollowupMutation, type Followup } from '../api';

/** Reception (re)assigns a request to a doctor, who then sees it (and the patient). */
export default function AssignDoctorModal({
  request,
  open,
  onClose,
}: {
  request: Followup;
  open: boolean;
  onClose: () => void;
}) {
  const [departmentId, setDepartmentId] = useState('');
  const [doctorId, setDoctorId] = useState(request.assignedDoctor?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [assign, assigning] = useAssignFollowupMutation();
  const submit = async () => {
    setError(null);
    if (!doctorId) {
      setError('Choose a doctor.');
      return;
    }
    try {
      await assign({ id: request.id, doctorId }).unwrap();
      toast.success('Doctor assigned');
      onClose();
    } catch (err) {
      setError(getQueryErrorMessage(err));
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Assign a doctor"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={assigning.isLoading}>
            Assign
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <DoctorPicker
          departmentId={departmentId}
          doctorId={doctorId}
          onDepartmentChange={setDepartmentId}
          onDoctorChange={(id) => setDoctorId(id)}
        />
      </div>
    </Modal>
  );
}
