import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import IconChip from '../../../components/ui/IconChip';

/** Card used by the public auth pages: optional icon, heading, one-line description, form. */
export default function AuthCard({
  title,
  subtitle,
  icon,
  children,
  footer,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  children: ReactNode;
  footer?: ReactNode;
  /** Wider card for longer forms (sign-up). */
  wide?: boolean;
}) {
  return (
    <div className={`w-full ${wide ? 'max-w-xl' : 'max-w-md'}`}>
      <div className="rounded-card border border-line bg-surface p-6 shadow-card sm:p-8">
        {icon && <IconChip icon={icon} size="lg" className="mb-5" />}
        <h1 className="text-page">{title}</h1>
        {subtitle && <p className="mt-1.5 text-sm text-muted">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </div>
      {footer && <div className="mt-5 text-center text-sm text-muted">{footer}</div>}
    </div>
  );
}
