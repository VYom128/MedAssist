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
    <ul className="space-y-0.5" aria-label="Password requirements">
      {checks.map((c) => (
        <li key={c.label} className={`flex items-center gap-1.5 ${c.ok ? 'text-emerald-700' : ''}`}>
          {c.ok ? (
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <Circle className="h-3.5 w-3.5" aria-hidden="true" />
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
