import { Link } from 'react-router-dom';
import { env } from '../utils/env';

/** The MedAssist mark: a rounded tile with a soft cross. Decorative. */
export function LogoMark({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={`shrink-0 ${className}`}>
      <rect width="32" height="32" rx="9" className="fill-primary-600" />
      <path
        d="M16 9.5v13M9.5 16h13"
        stroke="white"
        strokeWidth="3.2"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="24.5" cy="7.5" r="2.5" className="fill-primary-200" />
    </svg>
  );
}

/** Mark + app name, linking home. `textClassName` can hide the name (icon-only sidebar). */
export default function Wordmark({
  to,
  textClassName = '',
}: {
  to: string;
  textClassName?: string;
}) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-2.5 rounded-control focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
    >
      <LogoMark />
      <span className={`text-lg font-bold tracking-tight text-ink ${textClassName}`}>
        {env.appName}
      </span>
    </Link>
  );
}
