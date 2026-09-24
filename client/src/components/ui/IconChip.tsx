import type { LucideIcon } from 'lucide-react';
import { TONE_CLASSES, type Tone } from './statusStyles';

const SIZES = {
  sm: { box: 'h-8 w-8 rounded-control', icon: 'h-4 w-4' },
  md: { box: 'h-10 w-10 rounded-control', icon: 'h-5 w-5' },
  lg: { box: 'h-12 w-12 rounded-control', icon: 'h-6 w-6' },
};

/** A line icon on a soft tinted square (stat cards, empty states, section headers). Decorative. */
export default function IconChip({
  icon: Icon,
  tone = 'primary',
  size = 'md',
  className = '',
}: {
  icon: LucideIcon;
  tone?: Tone;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center ${SIZES[size].box} ${TONE_CLASSES[tone].chip} ${className}`}
    >
      <Icon className={SIZES[size].icon} />
    </span>
  );
}
