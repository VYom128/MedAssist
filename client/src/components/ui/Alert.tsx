import { CircleAlert, CircleCheck, Info, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

type Tone = 'error' | 'success' | 'info' | 'warning';

const TONES: Record<Tone, { box: string; icon: LucideIcon; iconColor: string }> = {
  error: {
    box: 'bg-danger-50 text-danger-700 border-danger-100',
    icon: CircleAlert,
    iconColor: 'text-danger-600',
  },
  success: {
    box: 'bg-success-50 text-success-700 border-success-100',
    icon: CircleCheck,
    iconColor: 'text-success-700',
  },
  info: {
    box: 'bg-info-50 text-info-700 border-info-100',
    icon: Info,
    iconColor: 'text-info-700',
  },
  warning: {
    box: 'bg-warning-50 text-warning-700 border-warning-100',
    icon: TriangleAlert,
    iconColor: 'text-warning-700',
  },
};

export default function Alert({
  tone = 'info',
  title,
  children,
}: {
  tone?: Tone;
  title?: string;
  children?: ReactNode;
}) {
  const { box, icon: Icon, iconColor } = TONES[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`flex gap-3 rounded-control border p-3.5 text-sm ${box}`}
    >
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${iconColor}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={title ? 'mt-1' : ''}>{children}</div>}
      </div>
    </div>
  );
}
