import { useState, type ReactNode } from 'react';
import toast from 'react-hot-toast';
import { getQueryErrorMessage } from '../utils/http';
import Alert from './ui/Alert';
import Button from './ui/Button';
import ConfirmDialog from './ui/ConfirmDialog';

/**
 * Activate / deactivate button for master data, with a confirmation. If the server refuses
 * (e.g. a department that still has doctors), its message is shown in the dialog.
 */
export default function StatusToggleButton({
  name,
  active,
  onToggle,
  deactivateWarning,
  size = 'normal',
}: {
  /** What is being toggled, for labels ("General Medicine"). */
  name: string;
  active: boolean;
  /** Calls the activate/deactivate endpoint; resolve on success, reject with the API error. */
  onToggle: (action: 'activate' | 'deactivate') => Promise<unknown>;
  deactivateWarning?: ReactNode;
  size?: 'normal' | 'small';
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const action = active ? 'deactivate' : 'activate';
  const verb = active ? 'Deactivate' : 'Activate';

  const close = () => {
    setOpen(false);
    setError(null);
  };
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onToggle(action);
      toast.success(`${name} ${active ? 'deactivated' : 'activated'}`);
      close();
    } catch (err) {
      setError(getQueryErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        variant={active ? 'ghost' : 'secondary'}
        className={size === 'small' ? '!px-2 !py-1' : ''}
        onClick={() => setOpen(true)}
        aria-label={`${verb} ${name}`}
      >
        {verb}
      </Button>
      <ConfirmDialog
        open={open}
        title={`${verb} ${name}?`}
        confirmLabel={verb}
        tone={active ? 'danger' : 'primary'}
        loading={busy}
        onConfirm={() => void confirm()}
        onCancel={close}
      >
        <div className="space-y-3">
          {error && <Alert tone="error">{error}</Alert>}
          <p>
            {active
              ? (deactivateWarning ??
                'It will be hidden from lists and cannot be chosen for new records.')
              : 'It will be available again.'}
          </p>
        </div>
      </ConfirmDialog>
    </>
  );
}
