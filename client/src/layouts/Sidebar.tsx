import { LogOut, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useState, type SyntheticEvent } from 'react';
import Avatar from '../components/ui/Avatar';
import { ROLE_LABELS } from '../constants/roles';
import type { CurrentUser } from '../features/auth/authSlice';
import type { NavItem } from '../routes/routeConfig';
import NavList, { type RailClasses } from './NavList';
import { useMediaQuery } from './useSidebarCollapsed';
import Wordmark from './Wordmark';

// Icon-only from 768 px; full width from 1280 px unless the user collapsed it.
const RAIL_ALWAYS: RailClasses = {
  link: 'md:justify-center md:px-0',
  label: 'md:sr-only',
  badge: 'md:absolute md:top-1 md:right-1 md:ml-0 md:px-1.5 md:py-0 md:text-[10px]',
};
const RAIL_UNTIL_XL: RailClasses = {
  link: 'md:justify-center md:px-0 xl:justify-start xl:px-3',
  label: 'md:sr-only xl:not-sr-only',
  badge:
    'md:absolute md:top-1 md:right-1 md:ml-0 md:px-1.5 md:py-0 md:text-[10px] xl:static xl:ml-auto xl:px-2 xl:py-0.5 xl:text-xs',
};

interface Tip {
  label: string;
  top: number;
  left: number;
}

/**
 * Sidebar (from 768 px): wordmark, the role menu, a collapse toggle (from 1280 px) and
 * the signed-in user with Log out. In icon-only mode, hovering or focusing an item shows its name.
 */
export default function Sidebar({
  user,
  items,
  home,
  collapsed,
  onToggleCollapsed,
  onLogout,
}: {
  user: CurrentUser;
  items: NavItem[];
  home: string;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onLogout: () => void;
}) {
  const wide = useMediaQuery('(min-width: 1280px)');
  const iconOnly = collapsed || !wide;
  const rail = collapsed ? RAIL_ALWAYS : RAIL_UNTIL_XL;
  const [tip, setTip] = useState<Tip | null>(null);

  const showTip = (label: string) => (e: SyntheticEvent<HTMLElement>) => {
    if (!iconOnly) return;
    const r = e.currentTarget.getBoundingClientRect();
    setTip({ label, top: r.top + r.height / 2, left: r.right + 10 });
  };
  const hideTip = () => setTip(null);
  const name = `${user.firstName} ${user.lastName}`;
  const toggleLabel = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;
  const iconButton =
    'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-control text-muted transition-colors hover:bg-surface-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-primary-600';

  return (
    <aside
      className={`sticky top-0 hidden h-screen shrink-0 flex-col border-r border-line bg-surface transition-[width] duration-250 ease-standard md:flex md:w-[4.75rem] print:hidden ${collapsed ? '' : 'xl:w-64'}`}
    >
      <div
        className={`flex h-16 shrink-0 items-center border-b border-line px-4 md:justify-center ${collapsed ? '' : 'xl:justify-start xl:px-5'}`}
      >
        <Wordmark to={home} textClassName={rail.label} />
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4" onScroll={hideTip}>
        <NavList items={items} rail={rail} onTip={showTip} onTipEnd={hideTip} />
      </div>

      <div className="shrink-0 space-y-2 border-t border-line p-3">
        <div className={`hidden xl:flex ${collapsed ? 'justify-center' : 'justify-end'}`}>
          <button
            type="button"
            onClick={() => {
              hideTip();
              onToggleCollapsed();
            }}
            onMouseEnter={showTip(toggleLabel)}
            onFocus={showTip(toggleLabel)}
            onMouseLeave={hideTip}
            onBlur={hideTip}
            aria-label={toggleLabel}
            aria-expanded={!collapsed}
            className={iconButton}
          >
            <ToggleIcon className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <div
          className={`flex items-center gap-3 rounded-control bg-surface-muted p-2 md:flex-col md:bg-transparent md:p-0 ${collapsed ? '' : 'xl:flex-row xl:bg-surface-muted xl:p-2'}`}
        >
          <Avatar name={name} size="sm" />
          <div className={`min-w-0 flex-1 ${rail.label}`}>
            <p className="truncate text-sm font-semibold text-ink">{name}</p>
            <p className="truncate text-xs text-muted">{ROLE_LABELS[user.role]}</p>
          </div>
          <button
            type="button"
            onClick={onLogout}
            onMouseEnter={showTip('Log out')}
            onFocus={showTip('Log out')}
            onMouseLeave={hideTip}
            onBlur={hideTip}
            aria-label="Log out"
            className={`${iconButton} hover:text-danger-700`}
          >
            <LogOut className="h-4.5 w-4.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {tip && (
        <div
          aria-hidden="true"
          style={{ top: tip.top, left: tip.left }}
          className="pointer-events-none fixed z-50 -translate-y-1/2 rounded-control bg-ink px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap text-white shadow-overlay motion-safe:animate-fade-in"
        >
          {tip.label}
        </div>
      )}
    </aside>
  );
}
