import { formatTime } from '../../utils/dates';
import type { SaveStatus } from './consultDraftSlice';

/** What the autosave indicator shows, for one or more autosaved parts (note, prescription). */
export interface SaveSummary {
  status: SaveStatus;
  savedAt: string | null;
  dirty: boolean;
}

/** The most important state first: stopped, offline, refused, saving, then saved. */
const RANK: SaveStatus[] = [
  'conflict',
  'locked',
  'closed',
  'offline',
  'error',
  'saving',
  'saved',
  'idle',
];

/** Combines the note's and the prescription's autosave into one indicator. */
export function combineSaves(...parts: (SaveSummary | undefined)[]): SaveSummary | undefined {
  const present = parts.filter((p): p is SaveSummary => Boolean(p));
  if (present.length === 0) return undefined;
  const status = RANK.find((r) => present.some((p) => p.status === r)) ?? 'idle';
  const savedAt =
    present
      .map((p) => p.savedAt)
      .filter((s): s is string => Boolean(s))
      .sort()
      .at(-1) ?? null;
  return { status, savedAt, dirty: present.some((p) => p.dirty) };
}

/** "Saving…", "Saved 10:42", "Offline – retrying", "Changed elsewhere – reload" (spec §4.7). */
export function autosaveLabel(s: SaveSummary | undefined): { text: string; tone: string } {
  if (!s) return { text: '', tone: 'text-muted' };
  switch (s.status) {
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
      if (s.dirty) return { text: 'Unsaved changes', tone: 'text-muted' };
      return s.savedAt
        ? { text: `Saved ${formatTime(s.savedAt)}`, tone: 'text-success-700' }
        : { text: 'All changes saved', tone: 'text-muted' };
  }
}
