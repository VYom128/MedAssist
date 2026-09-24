import { useState, type ReactNode } from 'react';
import Alert from './Alert';
import Button from './Button';
import Modal from './Modal';
import Textarea from './Textarea';

/**
 * Asks for a reason before an audited action (duplicate override, rejected link, deactivation,
 * rescheduling or cancelling an appointment).
 * The reason is stored in the audit log.
 */
export default function ReasonDialog({
  open,
  title,
  children,
  label = 'Reason',
  confirmLabel,
  minLength,
  tone = 'primary',
  loading = false,
  error,
  onSubmit,
  onCancel,
}: {
  open: boolean;
  title: string;
  children?: ReactNode;
  label?: string;
  confirmLabel: string;
  minLength: number;
  tone?: 'primary' | 'danger';
  loading?: boolean;
  error?: string | null;
  onSubmit: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const tooShort = reason.trim().length < minLength;

  const close = () => {
    setReason('');
    setTouched(false);
    onCancel();
  };
  const submit = () => {
    setTouched(true);
    if (!tooShort) onSubmit(reason.trim());
  };

  return (
    <Modal
      open={open}
      title={title}
      onClose={close}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={loading}>
            Cancel
          </Button>
          <Button variant={tone} onClick={submit} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {children && <div className="text-sm text-muted">{children}</div>}
        {error && <Alert tone="error">{error}</Alert>}
        <Textarea
          label={label}
          rows={3}
          value={reason}
          maxLength={500}
          onChange={(e) => setReason(e.target.value)}
          hint={`At least ${minLength} characters. Recorded in the audit log.`}
          error={
            touched && tooShort ? `Give a reason of at least ${minLength} characters` : undefined
          }
        />
      </div>
    </Modal>
  );
}
