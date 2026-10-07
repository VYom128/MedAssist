import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Alert from '../../../components/ui/Alert';
import Button from '../../../components/ui/Button';
import Modal from '../../../components/ui/Modal';
import { useAppSelector } from '../../../app/hooks';
import { getQueryErrorMessage } from '../../../utils/http';
import { selectCurrentUser } from '../../auth/authSlice';
import PatientPicker from '../../patients/components/PatientPicker';
import type { PatientListItem } from '../../patients/api';
import { useCreateInvoiceMutation } from '../api';
import { invoicesBase } from '../paths';

/**
 * A manual draft invoice for a patient (e.g. a procedure without a visit). Opens the editor.
 * Visit invoices are created by signing the note.
 */
export default function NewInvoiceModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const user = useAppSelector(selectCurrentUser);
  const navigate = useNavigate();
  const [patient, setPatient] = useState<PatientListItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [create, { isLoading }] = useCreateInvoiceMutation();

  const submit = async () => {
    if (!patient) return setError('Choose a patient');
    try {
      const inv = await create({ patientId: patient.id, items: [] }).unwrap();
      onClose();
      navigate(`${invoicesBase(user?.role)}/${inv.id}`);
    } catch (err) {
      setError(getQueryErrorMessage(err));
    }
    return undefined;
  };

  return (
    <Modal
      open={open}
      title="New invoice"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={isLoading}>
            Create draft
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <p className="text-sm text-muted">
          Visit invoices are drafted when the doctor signs the note. Use this for charges without a
          visit.
        </p>
        <PatientPicker value={patient} onChange={setPatient} />
      </div>
    </Modal>
  );
}
