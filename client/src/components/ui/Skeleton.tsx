/**
 * Loading placeholder block. Shimmers when motion is allowed, otherwise a flat tint. Decorative:
 * wrap a group in an element with `role="status"` and a screen-reader label (see ListSkeleton).
 */
export default function Skeleton({
  className = 'h-4 w-full',
  rounded = 'rounded-lg',
}: {
  className?: string;
  rounded?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={`bg-neutral-100 motion-safe:animate-shimmer motion-safe:bg-[linear-gradient(90deg,var(--color-neutral-50)_0%,var(--color-neutral-100)_40%,var(--color-neutral-50)_80%)] motion-safe:bg-[length:200%_100%] ${rounded} ${className}`}
    />
  );
}
