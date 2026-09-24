import type { ReactNode } from 'react';
import {
  STATUS_STYLES,
  TONE_CLASSES,
  type StatusDomain,
  type StatusKey,
  type StatusStyle,
} from './statusStyles';

/**
 * A status from the central map (statusStyles.ts): tinted pill with icon and label, so the
 * status never depends on colour alone. `children` overrides the label text.
 */
export default function StatusPill<D extends StatusDomain>({
  domain,
  status,
  children,
  size = 'md',
}: {
  domain: D;
  status: StatusKey<D>;
  children?: ReactNode;
  size?: 'sm' | 'md';
}) {
  const style = (STATUS_STYLES[domain] as Record<PropertyKey, StatusStyle>)[status];
  if (!style) return null;
  const { icon: Icon, tone, label } = style;
  const sizing = size === 'sm' ? 'gap-1 px-2 py-0.5 text-[11px]' : 'gap-1 px-2.5 py-0.5 text-xs';
  return (
    <span
      className={`inline-flex items-center rounded-full font-semibold whitespace-nowrap ring-1 ring-inset ${sizing} ${TONE_CLASSES[tone].pill}`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {children ?? label}
    </span>
  );
}
