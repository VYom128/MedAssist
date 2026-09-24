import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { TONE_CLASSES, type Tone } from './statusStyles';

export type BadgeTone =
  'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'purple' | 'primary';

const TONE_OF: Record<BadgeTone, Tone> = {
  neutral: 'neutral',
  info: 'info',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  purple: 'consult',
  primary: 'primary',
};

/**
 * Small rounded label (roles, counts, tags). For statuses use StatusPill, which picks tone, icon
 * and label from the central map.
 */
export default function Badge({
  tone = 'neutral',
  icon: Icon,
  dot = false,
  children,
}: {
  tone?: BadgeTone;
  /** Leading icon (decorative; the text carries the meaning). */
  icon?: LucideIcon;
  /** Leading coloured dot instead of an icon. */
  dot?: boolean;
  children: ReactNode;
}) {
  const t = TONE_CLASSES[TONE_OF[tone]];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ring-1 ring-inset ${t.pill}`}
    >
      {Icon ? (
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      ) : dot ? (
        <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${t.dot}`} />
      ) : null}
      {children}
    </span>
  );
}
