import { Menu } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import type { NavItem } from '../routes/routeConfig';

/**
 * Patients below 768 px: a bottom bar with the first four menu entries and "More" (opens the
 * full menu sheet). Touch targets are full-height cells (≥ 56 px).
 */
export default function BottomNav({
  items,
  onMore,
  moreOpen,
}: {
  items: NavItem[];
  onMore: () => void;
  moreOpen: boolean;
}) {
  const cell =
    'flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-semibold transition-colors duration-150 ease-standard focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-600';
  return (
    <nav
      aria-label="Quick menu"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] shadow-card md:hidden print:hidden"
    >
      <ul className="flex">
        {items.slice(0, 4).map(({ to, label, icon: Icon }) => (
          <li key={to} className="flex flex-1">
            <NavLink
              to={to}
              className={({ isActive }) =>
                `${cell} ${isActive ? 'text-primary-700' : 'text-muted hover:text-ink'}`
              }
            >
              <Icon className="h-5 w-5" aria-hidden="true" />
              <span className="truncate">{label}</span>
            </NavLink>
          </li>
        ))}
        <li className="flex flex-1">
          <button
            type="button"
            onClick={onMore}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            className={`${cell} text-muted hover:text-ink`}
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
            More
          </button>
        </li>
      </ul>
    </nav>
  );
}
