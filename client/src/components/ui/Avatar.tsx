import { TONE_CLASSES, type Tone } from './statusStyles';

const SIZES = {
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-14 w-14 text-lg',
  xl: 'h-20 w-20 text-2xl',
};

// No red: a red marker next to a person reads as an alert in a clinic.
const TINTS: readonly Tone[] = ['primary', 'info', 'success', 'warning', 'consult'];

/** Up to two initials from a display name ("Asha K. Rao" → "AR"). */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return `${first}${last}`.toUpperCase() || '?';
}

/** Same name → same tint, so a person is easy to spot across lists. */
function tintFor(name: string): Tone {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return TINTS[Math.abs(hash) % TINTS.length]!;
}

/**
 * Round initials avatar (we store no photos). Decorative by default because the name is shown
 * next to it; pass `labelled` when it stands alone.
 */
export default function Avatar({
  name,
  size = 'md',
  labelled = false,
  className = '',
}: {
  name: string;
  size?: keyof typeof SIZES;
  labelled?: boolean;
  className?: string;
}) {
  return (
    <span
      {...(labelled ? { role: 'img', 'aria-label': name } : { 'aria-hidden': true })}
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold ring-2 ring-surface ${SIZES[size]} ${TONE_CLASSES[tintFor(name)].chip} ${className}`}
    >
      {initialsOf(name)}
    </span>
  );
}
