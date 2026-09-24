export default function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block rounded-full motion-safe:animate-spin border-2 border-current border-r-transparent ${className}`}
    />
  );
}
