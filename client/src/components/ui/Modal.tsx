import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';

const PANEL = {
  dialog: {
    wrapper: 'items-end justify-center sm:items-center sm:p-4',
    panel:
      'max-h-[90vh] w-full rounded-t-card sm:rounded-card data-closed:translate-y-full sm:data-closed:translate-y-0 sm:data-closed:scale-[0.98] sm:data-closed:opacity-0',
  },
  drawer: {
    wrapper: 'items-end justify-center sm:items-stretch sm:justify-end',
    panel:
      'max-h-[90vh] w-full rounded-t-card sm:h-full sm:max-h-none sm:rounded-tr-none sm:rounded-l-card data-closed:translate-y-full sm:data-closed:translate-y-0 sm:data-closed:translate-x-full',
  },
};
const SIZES = { md: 'sm:max-w-lg', lg: 'sm:max-w-2xl' };

/**
 * Accessible modal dialog (Headless UI): focus moves inside on open and returns on close, Tab
 * stays inside, Escape and a click outside close it, the page behind cannot scroll. Full-width
 * sheet on phones; from `sm` a centred card (`variant="dialog"`) or a panel on the right
 * (`variant="drawer"`). Fades and rises in; respects reduced motion.
 */
export default function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  variant = 'dialog',
  size = 'md',
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  variant?: 'dialog' | 'drawer';
  size?: 'md' | 'lg';
}) {
  return (
    <Dialog open={open} onClose={() => onClose()} className="relative z-50">
      <DialogBackdrop
        transition
        className="fixed inset-0 bg-ink/40 transition-opacity duration-250 ease-standard data-closed:opacity-0 data-leave:duration-200"
      />
      <div className={`fixed inset-0 flex ${PANEL[variant].wrapper}`}>
        <DialogPanel
          transition
          className={`relative flex flex-col overflow-y-auto bg-surface shadow-overlay transition duration-250 ease-standard data-leave:duration-200 ${PANEL[variant].panel} ${SIZES[size]}`}
        >
          <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
            <DialogTitle as="h2" className="text-section">
              {title}
            </DialogTitle>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-mr-2 inline-flex h-10 w-10 items-center justify-center rounded-control text-muted transition-colors hover:bg-neutral-50 hover:text-ink focus-visible:outline-2 focus-visible:outline-primary-600"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          <div className="flex-1 px-5 py-5 sm:px-6">{children}</div>
          {footer && (
            <div className="flex flex-col-reverse gap-2 border-t border-line bg-surface-muted px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
              {footer}
            </div>
          )}
        </DialogPanel>
      </div>
    </Dialog>
  );
}
