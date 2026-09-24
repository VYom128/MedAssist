import { Check, CircleAlert, CloudOff, Loader2, PencilLine } from 'lucide-react';
import { autosaveLabel, type SaveSummary } from '../autosaveLabel';

const ICONS = {
  saving: Loader2,
  offline: CloudOff,
  conflict: CircleAlert,
  locked: CircleAlert,
  closed: CircleAlert,
  error: CircleAlert,
};

/** The autosave indicator in the workspace header (announced politely). */
export default function AutosaveStatus({ summary }: { summary: SaveSummary | undefined }) {
  const { text, tone } = autosaveLabel(summary);
  const Icon =
    (summary && ICONS[summary.status as keyof typeof ICONS]) ??
    (summary?.dirty ? PencilLine : Check);
  return (
    <p
      role="status"
      aria-live="polite"
      className={`inline-flex items-center gap-1.5 text-sm font-medium ${tone}`}
    >
      {text && (
        <Icon
          className={`h-4 w-4 ${summary?.status === 'saving' ? 'motion-safe:animate-spin' : ''}`}
          aria-hidden="true"
        />
      )}
      {text}
    </p>
  );
}
