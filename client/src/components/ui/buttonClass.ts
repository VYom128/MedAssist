export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'soft' | 'softDanger';
export type ButtonSize = 'sm' | 'md';

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-primary-600 text-white shadow-card hover:bg-primary-700 active:bg-primary-800 focus-visible:outline-primary-600',
  secondary:
    'border border-line-strong bg-surface text-ink shadow-card hover:border-line-control hover:bg-surface-muted focus-visible:outline-primary-600',
  danger:
    'bg-danger-600 text-white shadow-card hover:bg-danger-700 focus-visible:outline-danger-600',
  ghost: 'text-muted hover:bg-neutral-50 hover:text-ink focus-visible:outline-primary-600',
  soft: 'bg-primary-50 text-primary-700 hover:bg-primary-100 focus-visible:outline-primary-600',
  softDanger: 'bg-danger-50 text-danger-700 hover:bg-danger-100 focus-visible:outline-danger-600',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'min-h-11 px-3 py-1.5 md:min-h-9',
  md: 'min-h-11 px-4 py-2',
};

/** Button classes, also for links that should look like buttons (`<Link className={…}>`). */
export function buttonClass(variant: ButtonVariant = 'primary', size: ButtonSize = 'md') {
  return `inline-flex items-center justify-center gap-2 rounded-control text-sm font-semibold transition-[color,background-color,border-color,box-shadow,transform] duration-150 ease-standard focus-visible:outline-2 motion-safe:active:scale-[0.98] disabled:active:scale-100 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-55 ${SIZES[size]} ${VARIANTS[variant]}`;
}
