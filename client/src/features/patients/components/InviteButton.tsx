import { Send } from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import Button from '../../../components/ui/Button';
import ConfirmDialog from '../../../components/ui/ConfirmDialog';
import { getQueryErrorMessage } from '../../../utils/http';
import { usePortalInviteMutation, type Patient } from '../api';

/** "Invite to patient portal": needs an email on the record and an active patient. */
export default function InviteButton({ patient }: { patient: Patient }) {
  const [invite, { isLoading }] = usePortalInviteMutation();
  const [open, setOpen] = useState(false);

  if (!patient.email) {
    return (
      <p className="text-sm text-muted">
        Add an email address to the patient's details to invite them to the portal.
      </p>
    );
  }
  if (!patient.isActive) return null;

  const confirm = async () => {
    try {
      await invite(patient.id).unwrap();
      toast.success(`Invitation sent to ${patient.email}`);
    } catch (err) {
      toast.error(getQueryErrorMessage(err));
    } finally {
      setOpen(false);
    }
  };

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Send className="h-4 w-4" aria-hidden="true" /> Invite to patient portal
      </Button>
      <ConfirmDialog
        open={open}
        title="Invite to the patient portal?"
        confirmLabel="Send invitation"
        loading={isLoading}
        onConfirm={() => void confirm()}
        onCancel={() => setOpen(false)}
      >
        We will email {patient.email} a link to set a password (valid 72 hours). Make sure the
        address belongs to the patient.
      </ConfirmDialog>
    </>
  );
}
