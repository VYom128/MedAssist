import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react';
import { X } from 'lucide-react';
import Avatar from '../components/ui/Avatar';
import { ROLE_LABELS } from '../constants/roles';
import type { CurrentUser } from '../features/auth/authSlice';
import type { NavItem } from '../routes/routeConfig';
import NavList from './NavList';

/**
 * Menu below 768 px: a bottom sheet (spec §13.3) with the role menu. Headless UI Dialog traps
 * focus, closes on Escape / outside tap and returns focus to the menu button.
 */
export default function MobileNav({
  open,
  onClose,
  user,
  items,
}: {
  open: boolean;
  onClose: () => void;
  user: CurrentUser;
  items: NavItem[];
}) {
  const name = `${user.firstName} ${user.lastName}`;
  return (
    <Dialog open={open} onClose={onClose} className="relative z-40 md:hidden">
      <DialogBackdrop
        transition
        className="fixed inset-0 bg-ink/40 transition-opacity duration-250 ease-standard data-closed:opacity-0 data-leave:duration-200"
      />
      <div className="fixed inset-x-0 bottom-0 flex justify-center">
        <DialogPanel
          transition
          className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-t-card bg-surface shadow-overlay transition duration-250 ease-standard data-closed:translate-y-full data-leave:duration-200"
        >
          <div
            aria-hidden="true"
            className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-line-strong"
          />
          <DialogTitle className="sr-only">Menu</DialogTitle>
          <div className="flex items-center justify-between gap-3 px-5 pt-2 pb-3">
            <div className="flex min-w-0 items-center gap-3">
              <Avatar name={name} size="md" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">{name}</p>
                <p className="truncate text-xs text-muted">{ROLE_LABELS[user.role]}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close menu"
              className="inline-flex h-11 w-11 items-center justify-center rounded-control text-muted hover:bg-surface-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-primary-600"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          <div className="overflow-y-auto border-t border-line px-3 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <NavList items={items} />
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
