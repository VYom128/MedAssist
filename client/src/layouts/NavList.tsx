import type { FocusEventHandler, MouseEventHandler } from 'react';
import { NavLink } from 'react-router-dom';
import type { NavItem } from '../routes/routeConfig';
import NavBadge from './NavBadge';

/** Responsive classes for the desktop sidebar: icon-only from lg, full from xl unless collapsed. */
export interface RailClasses {
  link: string;
  label: string;
  badge: string;
}

const NO_RAIL: RailClasses = { link: '', label: '', badge: '' };

/**
 * The role's menu (items from routeConfig via navItemsFor). Used by the desktop sidebar and the
 * phone bottom sheet. `onTip`/`onTipEnd` let the sidebar show a tooltip in icon-only mode.
 */
export default function NavList({
  items,
  rail = NO_RAIL,
  onTip,
  onTipEnd,
}: {
  items: NavItem[];
  rail?: RailClasses;
  onTip?: (label: string) => MouseEventHandler<HTMLElement> & FocusEventHandler<HTMLElement>;
  onTipEnd?: () => void;
}) {
  return (
    <nav aria-label="Main">
      <ul className="space-y-1">
        {items.map(({ to, label, icon: Icon, badge }) => (
          <li key={to}>
            <NavLink
              to={to}
              onMouseEnter={onTip?.(label)}
              onFocus={onTip?.(label)}
              onMouseLeave={onTipEnd}
              onBlur={onTipEnd}
              className={({ isActive }) =>
                `group relative flex min-h-11 items-center gap-3 rounded-control px-3 text-sm font-medium transition-colors duration-200 ease-standard focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-600 ${rail.link} ${
                  isActive
                    ? 'bg-primary-50 font-semibold text-primary-700'
                    : 'text-muted hover:bg-surface-muted hover:text-ink'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon
                    className={`h-5 w-5 shrink-0 ${isActive ? 'text-primary-600' : 'text-subtle group-hover:text-ink'}`}
                    aria-hidden="true"
                  />
                  <span className={`truncate ${rail.label}`}>{label}</span>
                  {badge && <NavBadge kind={badge} className={rail.badge} />}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
