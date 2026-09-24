import { TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import Button from './Button';
import IconChip from './IconChip';
import Modal from './Modal';

/** Asks before a consequential action (deactivate, sign out a device…). */
export default function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel = 'Confirm',
  tone = 'primary',
  loading = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  tone?: 'primary' | 'danger';
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={loading}>
            Cancel
          </Button>
          <Button variant={tone} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex gap-4">
        {tone === 'danger' && <IconChip icon={TriangleAlert} tone="danger" />}
        <div className="min-w-0 flex-1 text-sm text-muted">{children}</div>
      </div>
    </Modal>
  );
}
