import { useCallback, useEffect, useRef } from 'react';
import { useStore } from 'react-redux';
import { useAppDispatch, useAppSelector } from '../../app/hooks';
import type { RootState } from '../../app/store';
import { isApiQueryError } from '../../utils/http';
import { useUpdateEncounterMutation } from './api';
import {
  BLOCKED,
  edited,
  hasChanges,
  saveFailed,
  saveStarted,
  saveSucceeded,
  type DraftEntry,
  type SaveStatus,
} from './consultDraftSlice';

export type FailedStatus = Exclude<SaveStatus, 'idle' | 'saving' | 'saved'>;
import { splitSendable, toBody } from './fields';
import type { NoteChanges } from './api';

/** How a failed save is shown and whether autosave carries on (see useAutosave). */
export function classify(err: unknown): { status: FailedStatus; message?: string } {
  const status = isApiQueryError(err) ? err.status : 0;
  const code = isApiQueryError(err) ? err.code : '';
  const message = isApiQueryError(err) ? err.message : undefined;
  if (status === 0 || status >= 500 || status === 429) return { status: 'offline' };
  if (code === 'CONFLICT') return { status: 'conflict', message };
  if (code === 'RECORD_LOCKED') return { status: 'locked', message };
  if (code === 'DOCUMENTATION_WINDOW_CLOSED') return { status: 'closed', message };
  return { status: 'error', message };
}

/** Autosave 2 s after the doctor stops typing (spec §4.7 step 4). */
export const AUTOSAVE_DELAY_MS = 2000;
const MAX_BACKOFF_MS = 30_000;

/**
 * Autosave of one draft note (consultDraft slice): debounced after edits, immediately on
 * `saveNow()` (blur, tab change, Ctrl/Cmd+S, before signing). One request at a time; edits
 * made meanwhile go in the next one. Sends expectedVersion and keeps the returned revision.
 * - network/server failure → "offline", retried with back-off (2 s, 4 s … 30 s);
 * - 409 CONFLICT → "conflict", 409 RECORD_LOCKED → "locked", 422 window closed → "closed":
 *   autosave stops until the doctor reloads;
 * - other refusals (validation) → "error"; the next edit tries again.
 */
export function useAutosave(encounterId: string | undefined) {
  const dispatch = useAppDispatch();
  const store = useStore<RootState>();
  const entry = useAppSelector((s) => (encounterId ? s.consultDraft[encounterId] : undefined));
  const [update] = useUpdateEncounterMutation();
  const again = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const current = useCallback(
    (): DraftEntry | undefined =>
      encounterId ? store.getState().consultDraft[encounterId] : undefined,
    [encounterId, store],
  );

  const saveNow = useCallback(async (): Promise<boolean> => {
    clearTimeout(timer.current);
    // Loops while edits arrived during a save (one request in flight at a time).
    for (;;) {
      const e = current();
      if (!encounterId || !e || BLOCKED.includes(e.status)) return false;
      if (e.inFlight) {
        again.current = true;
        return false;
      }
      const { send } = splitSendable(e.edits);
      if (!hasChanges(send)) return true;
      dispatch(saveStarted({ id: encounterId, sent: send }));
      try {
        const saved = await update({
          id: encounterId,
          body: { expectedVersion: e.revision, ...toBody(send) },
        }).unwrap();
        dispatch(
          saveSucceeded({
            id: encounterId,
            revision: saved.revision,
            savedAt: new Date().toISOString(),
          }),
        );
        if (!again.current) return true;
        again.current = false;
      } catch (err) {
        again.current = false;
        dispatch(saveFailed({ id: encounterId, ...classify(err) }));
        return false;
      }
    }
  }, [current, dispatch, encounterId, update]);

  // Debounced save after edits.
  const edits = entry?.edits;
  const status = entry?.status;
  useEffect(() => {
    if (!edits || !status || BLOCKED.includes(status)) return;
    if (status === 'offline' || status === 'error') return;
    if (!hasChanges(splitSendable(edits).send)) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void saveNow(), AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer.current);
  }, [edits, status, saveNow]);

  // Offline: retry with back-off.
  const retries = entry?.retries ?? 0;
  useEffect(() => {
    if (status !== 'offline') return;
    const t = setTimeout(
      () => void saveNow(),
      Math.min(MAX_BACKOFF_MS, AUTOSAVE_DELAY_MS * 2 ** Math.max(0, retries - 1)),
    );
    return () => clearTimeout(t);
  }, [status, retries, saveNow]);

  // Ctrl/Cmd+S saves at once.
  useEffect(() => {
    if (!encounterId) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveNow();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [encounterId, saveNow]);

  const change = useCallback(
    (changes: NoteChanges) => {
      if (encounterId) dispatch(edited({ id: encounterId, changes }));
    },
    [dispatch, encounterId],
  );

  const dirty = Boolean(entry && (hasChanges(entry.edits) || entry.inFlight));
  return { entry, change, saveNow, dirty };
}
