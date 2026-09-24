import { formatTime } from '../../utils/dates';
import { hasChanges, type DraftEntry } from './consultDraftSlice';

/** "Saving…", "Saved 10:42", "Offline – retrying", "Changed elsewhere – reload" (spec §4.7). */
export function autosaveLabel(entry: DraftEntry | undefined): { text: string; tone: string } {
  if (!entry) return { text: '', tone: 'text-muted' };
  switch (entry.status) {
    case 'saving':
      return { text: 'Saving…', tone: 'text-muted' };
    case 'offline':
      return { text: 'Offline – retrying', tone: 'text-warning-700' };
    case 'conflict':
    case 'locked':
      return { text: 'Changed elsewhere – reload', tone: 'text-danger-700' };
    case 'closed':
      return { text: 'Editing closed', tone: 'text-danger-700' };
    case 'error':
      return { text: 'Not saved – check the fields', tone: 'text-danger-700' };
    default:
      if (hasChanges(entry.edits)) return { text: 'Unsaved changes', tone: 'text-muted' };
      return entry.savedAt
        ? { text: `Saved ${formatTime(entry.savedAt)}`, tone: 'text-success-700' }
        : { text: 'All changes saved', tone: 'text-muted' };
  }
}
