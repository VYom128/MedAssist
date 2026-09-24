import { CalendarDays, Hourglass } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useAppSelector } from '../../../app/hooks';
import IconChip from '../../../components/ui/IconChip';
import PageHeader from '../../../components/ui/PageHeader';
import QuickLinkCard from '../../../components/ui/QuickLinkCard';
import { ROLE_LABELS } from '../../../constants/roles';
import NavBadge from '../../../layouts/NavBadge';
import { ACCOUNT_LINKS } from '../../../layouts/accountLinks';
import { navItemsFor } from '../../../routes/routeConfig';
import { clinicDate, formatInClinic } from '../../../utils/dates';
import { selectCurrentUser } from '../../auth/authSlice';
import { LINK_DESCRIPTIONS, ROLE_DESCRIPTIONS } from '../quickLinks';

/** Today in the clinic timezone, e.g. "Thursday, 24 Sep 2026". */
export function TodayPill() {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-2 text-sm font-medium text-ink shadow-card">
      <CalendarDays className="h-4 w-4 text-primary-600" aria-hidden="true" />
      <time dateTime={clinicDate()}>{formatInClinic(new Date(), 'EEEE, dd MMM yyyy')}</time>
    </span>
  );
}

/** Cards stagger in once per page load; coming back to the dashboard shows them at once. */
let hasStaggered = false;

/**
 * Role dashboard shell until the real widgets (spec §14) arrive in Phase 10: greeting, real cards
 * passed as children, quick links to the role's existing pages (from routeConfig) and the list of
 * what is coming. `hideLinksTo` drops links a card above already offers.
 */
export default function DashboardPlaceholder({
  upcoming,
  children,
  hideLinksTo = [],
}: {
  upcoming: string[];
  /** Real cards shown above the quick links. */
  children?: ReactNode;
  hideLinksTo?: string[];
}) {
  const user = useAppSelector(selectCurrentUser);
  const [stagger] = useState(() => !hasStaggered);
  useEffect(() => {
    hasStaggered = true;
  }, []);
  if (!user) return null;

  const roleLinks = navItemsFor(user.role).filter(
    (item) => !item.to.endsWith('/dashboard') && !hideLinksTo.includes(item.to),
  );
  // Roles with no pages of their own yet (lab) get their account pages instead.
  const links =
    roleLinks.length > 0 ? roleLinks : ACCOUNT_LINKS.filter((l) => l.to !== '/change-password');

  return (
    <section className="space-y-8">
      <PageHeader
        eyebrow={`${ROLE_LABELS[user.role]} dashboard`}
        title={`Welcome, ${user.firstName}`}
        description={ROLE_DESCRIPTIONS[user.role]}
        actions={<TodayPill />}
      />

      {children}

      <section aria-labelledby="quick-links-title">
        <h2 id="quick-links-title" className="mb-4 text-section">
          {roleLinks.length > 0 ? 'Quick links' : 'Your account'}
        </h2>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {links.map((link, i) => (
            <li
              key={link.to}
              className={stagger ? 'motion-safe:animate-fade-up' : undefined}
              style={stagger ? { animationDelay: `${i * 40}ms` } : undefined}
            >
              <QuickLinkCard
                to={link.to}
                title={link.label}
                description={LINK_DESCRIPTIONS[link.to]}
                icon={link.icon}
                badge={'badge' in link && link.badge ? <NavBadge kind={link.badge} /> : undefined}
              />
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-labelledby="upcoming-title"
        className="rounded-card border border-dashed border-line-strong bg-surface-muted p-5 lg:p-6"
      >
        <div className="flex items-start gap-3">
          <IconChip icon={Hourglass} tone="neutral" size="sm" />
          <div className="min-w-0">
            <h2 id="upcoming-title" className="text-card">
              Coming in later phases
            </h2>
            <ul className="mt-3 flex flex-wrap gap-2">
              {upcoming.map((item) => (
                <li
                  key={item}
                  className="rounded-full border border-line bg-surface px-3 py-1 text-sm text-muted"
                >
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </section>
  );
}
