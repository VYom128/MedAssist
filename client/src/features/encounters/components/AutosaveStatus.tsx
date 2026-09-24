import { CircleAlert, CloudOff, Loader2, Check, PencilLine } from 'lucide-react';
import { autosaveLabel } from '../autosaveLabel';
import { hasChanges, type DraftEntry } from '../consultDraftSlice';

const ICONS = {
  saving: Loader2,
  offline: CloudOff,
  conflict: CircleAlert,
  locked: CircleAlert,
  closed: CircleAlert,
  error: CircleAlert,
};

export default function AutosaveStatus({ entry }: { entry: DraftEntry | undefined }) {
  const { text, tone } = autosaveLabel(entry);
  const Icon =
    (entry && ICONS[entry.status as keyof typeof ICONS]) ??
    (entry && hasChanges(entry.edits) ? PencilLine : Check);
  return (
    <p
      role="status"
      aria-live="polite"
      className={`inline-flex items-center gap-1.5 text-sm font-medium ${tone}`}
    >
      {text && (
        <Icon
          className={`h-4 w-4 ${entry?.status === 'saving' ? 'motion-safe:animate-spin' : ''}`}
          aria-hidden="true"
        />
      )}
      {text}
    </p>
  );
}
