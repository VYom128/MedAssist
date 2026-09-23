import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const PANEL = {
  dialog: {
    wrapper: 'items-end justify-center sm:items-center sm:p-4',
    panel: 'max-h-[90vh] w-full rounded-t-2xl sm:rounded-2xl',
  },
  drawer: {
    wrapper: 'items-end justify-center sm:items-stretch sm:justify-end',
    panel: 'max-h-[90vh] w-full rounded-t-2xl sm:h-full sm:max-h-none sm:rounded-none',
  },
};
const SIZES = { md: 'sm:max-w-lg', lg: 'sm:max-w-2xl' };

/**
 * Accessible modal dialog: focus moves inside on open and returns on close, Tab stays inside,
 * Escape and the backdrop close it. Full-width sheet on phones; from `sm` a centred card
 * (`variant="dialog"`) or a panel on the right (`variant="drawer"`).
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
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  // Parents usually pass a new onClose each render; a ref keeps the effect below from re-running
  // (which would steal focus back to the first control while the user types).
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const first = panel.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel.current)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
      if (e.key !== 'Tab' || !panel.current) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) return;
      const [firstItem, lastItem] = [items[0]!, items[items.length - 1]!];
      if (e.shiftKey && document.activeElement === firstItem) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && document.activeElement === lastItem) {
        e.preventDefault();
        firstItem.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className={`fixed inset-0 z-50 flex ${PANEL[variant].wrapper}`}>
      <div className="absolute inset-0 bg-slate-900/40" aria-hidden="true" onClick={onClose} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative flex flex-col overflow-y-auto bg-white shadow-xl ${PANEL[variant].panel} ${SIZES[size]}`}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 id={titleId} className="text-lg font-semibold">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-slate-500 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-brand-600"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <div className="flex-1 px-5 py-4">{children}</div>
        {footer && (
          <div className="flex flex-col-reverse gap-2 border-t border-slate-100 px-5 py-4 sm:flex-row sm:justify-end">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
