import { useCallback, useEffect, useRef } from 'react';
import { useStore } from 'react-redux';
import { useAppDispatch, useAppSelector } from '../../app/hooks';
import type { RootState } from '../../app/store';
import { BLOCKED } from '../encounters/consultDraftSlice';
import { AUTOSAVE_DELAY_MS, classify } from '../encounters/useAutosave';
import { usePutPrescriptionDraftMutation, type Prescription } from './api';
import { rowProblems, rowsFrom, toInput, type RxLocal } from './rows';
import {
  rxDiscarded,
  rxEdited,
  rxOpened,
  rxSaveFailed,
  rxSaveStarted,
  rxSaveSucceeded,
} from './rxDraftSlice';

const MAX_BACKOFF_MS = 30_000;

/**
 * The draft prescription of a note, edited with the same autosave rules as the note (debounced,
 * one request at a time, expectedVersion, offline retry, conflict stops). The whole prescription
 * is sent (PUT replaces it), so nothing is sent while a row is incomplete (`problems`).
 * `server` is the current prescription (null: none yet); only drafts are editable.
 */
export function usePrescriptionDraft(
  encounterId: string,
  server: Prescription | null,
  ready: boolean,
) {
  const dispatch = useAppDispatch();
  const store = useStore<RootState>();
  const entry = useAppSelector((s) => s.rxDraft[encounterId]);
  const [put] = usePutPrescriptionDraftMutation();
  const again = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const serverRevision = server?.status === 'draft' ? (server.revision ?? 0) : null;
  useEffect(() => {
    if (ready) dispatch(rxOpened({ id: encounterId, revision: serverRevision }));
  }, [dispatch, encounterId, ready, serverRevision]);

  const local: RxLocal = entry?.local ?? rowsFrom(server);
  const problems = rowProblems(local.rows);

  const saveNow = useCallback(async (): Promise<boolean> => {
    clearTimeout(timer.current);
    for (;;) {
      const e = store.getState().rxDraft[encounterId];
      if (!e || BLOCKED.includes(e.status)) return false;
      if (e.sending !== null) {
        again.current = true;
        return false;
      }
      if (!e.local) return true;
      if (Object.keys(rowProblems(e.local.rows)).length > 0) return false;
      dispatch(rxSaveStarted({ id: encounterId }));
      try {
        const saved = await put({
          encounterId,
          ...(e.revision !== null ? { expectedVersion: e.revision } : {}),
          items: e.local.rows.map(toInput),
          generalInstructions: e.local.generalInstructions.trim() || null,
        }).unwrap();
        dispatch(
          rxSaveSucceeded({
            id: encounterId,
            revision: saved.revision ?? 0,
            savedAt: new Date().toISOString(),
          }),
        );
        if (!again.current) return true;
        again.current = false;
      } catch (err) {
        again.current = false;
        dispatch(rxSaveFailed({ id: encounterId, ...classify(err) }));
        return false;
      }
    }
  }, [dispatch, encounterId, put, store]);

  // Debounced save after edits (not while rows are incomplete or autosave is stopped).
  const seq = entry?.seq ?? 0;
  const status = entry?.status;
  const complete = Object.keys(problems).length === 0;
  useEffect(() => {
    if (!entry?.local || !status || BLOCKED.includes(status)) return;
    if (status === 'offline' || status === 'error' || !complete) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void saveNow(), AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new edit (seq) re-arms the timer
  }, [seq, status, complete, saveNow]);

  const retries = entry?.retries ?? 0;
  useEffect(() => {
    if (status !== 'offline') return;
    const t = setTimeout(
      () => void saveNow(),
      Math.min(MAX_BACKOFF_MS, AUTOSAVE_DELAY_MS * 2 ** Math.max(0, retries - 1)),
    );
    return () => clearTimeout(t);
  }, [status, retries, saveNow]);

  const change = useCallback(
    (next: RxLocal) => dispatch(rxEdited({ id: encounterId, local: next })),
    [dispatch, encounterId],
  );
  const discard = useCallback(
    (revision: number | null) => dispatch(rxDiscarded({ id: encounterId, revision })),
    [dispatch, encounterId],
  );

  return {
    entry,
    local,
    problems,
    dirty: Boolean(entry?.local) || entry?.sending != null,
    change,
    saveNow,
    discard,
  };
}

export type PrescriptionDraft = ReturnType<typeof usePrescriptionDraft>;
