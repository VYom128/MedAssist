import { Check, Circle } from 'lucide-react';
import { passwordChecks } from '../schemas';

/** Live password hints; the server also rejects the 1,000 most common passwords. */
export default function PasswordChecklist({
  password,
  email,
  firstName,
}: {
  password: string;
  email?: string;
  firstName?: string;
}) {
  const checks = passwordChecks(password, { email, firstName });
  return (
    <ul className="grid gap-x-4 gap-y-1 pt-0.5 sm:grid-cols-2" aria-label="Password requirements">
      {checks.map((c) => (
        <li
          key={c.label}
          className={`flex items-start gap-1.5 transition-colors duration-150 ${c.ok ? 'text-success-700' : 'text-muted'}`}
        >
          {c.ok ? (
            <Check className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          ) : (
            <Circle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          )}
          <span>
            {c.label}
            <span className="sr-only">{c.ok ? ' (met)' : ' (not met)'}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
