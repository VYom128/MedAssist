import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { loggedOut } from '../auth/authSlice';
import type { Encounter, NoteChanges } from './api';

/**
 * Unsaved edits of open clinical notes (spec §13.2 `consultDraft`). MEMORY ONLY: clinical drafts
 * are patient data and never go to localStorage/sessionStorage; a reload loses what autosave had
 * not sent yet (the page warns before leaving).
 *
 * Per note: `edits` not sent yet, `inFlight` sent and awaiting the answer (one save at a time),
 * the `revision` to send as expectedVersion, and the autosave status. What the doctor sees is the
 * cached server note overlaid with `inFlight`, then `edits`.
 */

export type SaveStatus =
  | 'idle'
  | 'saving'
  | 'saved'
  /** Network or server trouble: retried with back-off. */
  | 'offline'
  /** 409 CONFLICT: changed in another tab – autosave stops until the doctor reloads. */
  | 'conflict'
  /** 409 RECORD_LOCKED: signed elsewhere – autosave stops. */
  | 'locked'
  /** 422 DOCUMENTATION_WINDOW_CLOSED – autosave stops. */
  | 'closed'
  /** Refused (e.g. validation); the next edit tries again. */
  | 'error';

export interface DraftEntry {
  revision: number;
  edits: NoteChanges;
  inFlight: NoteChanges | null;
  status: SaveStatus;
  savedAt: string | null;
  message: string | null;
  /** Consecutive offline failures (back-off). */
  retries: number;
}

export type ConsultDraftState = Record<string, DraftEntry>;

/** Statuses in which autosave does not run. */
export const BLOCKED: readonly SaveStatus[] = ['conflict', 'locked', 'closed'];

/**
 * Later changes win; vitals merge field by field, and a vital set to `undefined` drops its
 * pending change (an invalid entry must not leave an earlier keystroke's value to be saved).
 */
export function mergeChanges(a: NoteChanges, b: NoteChanges): NoteChanges {
  const merged: NoteChanges = { ...a, ...b };
  if (a.vitals || b.vitals) {
    const vitals = { ...a.vitals, ...b.vitals };
    for (const key of Object.keys(vitals) as (keyof typeof vitals)[]) {
      if (vitals[key] === undefined) delete vitals[key];
    }
    merged.vitals = vitals;
  }
  return merged;
}

export const hasChanges = (c: NoteChanges | null | undefined) =>
  Boolean(c) &&
  Object.entries(c!).some(
    ([k, v]) => v !== undefined && (k !== 'vitals' || Object.keys(v as object).length > 0),
  );

/** The note as the doctor sees it: server values, then what is in flight, then local edits. */
export function applyChanges(e: Encounter, entry: DraftEntry | undefined): Encounter {
  if (!entry) return e;
  const changes = mergeChanges(entry.inFlight ?? {}, entry.edits);
  const { vitals, ...rest } = changes;
  return {
    ...e,
    ...(Object.fromEntries(
      Object.entries(rest).filter(([, v]) => v !== undefined),
    ) as Partial<Encounter>),
    vitals: { ...e.vitals, ...vitals },
  };
}

const empty = (revision: number): DraftEntry => ({
  revision,
  edits: {},
  inFlight: null,
  status: 'idle',
  savedAt: null,
  message: null,
  retries: 0,
});

const slice = createSlice({
  name: 'consultDraft',
  initialState: {} as ConsultDraftState,
  reducers: {
    /** A note was loaded: start tracking it, or take the server's revision when nothing is pending. */
    opened(state, { payload }: PayloadAction<{ id: string; revision: number }>) {
      const entry = state[payload.id];
      if (!entry) state[payload.id] = empty(payload.revision);
      else if (!hasChanges(entry.edits) && !entry.inFlight && !BLOCKED.includes(entry.status)) {
        entry.revision = Math.max(entry.revision, payload.revision);
      }
    },
    edited(state, { payload }: PayloadAction<{ id: string; changes: NoteChanges }>) {
      const entry = state[payload.id];
      if (!entry) return;
      entry.edits = mergeChanges(entry.edits, payload.changes);
      // A new edit after a save or a refused save starts a fresh attempt.
      if (entry.status === 'saved' || entry.status === 'error') entry.status = 'idle';
    },
    /** `sent` (a part of `edits`) goes to the server; the rest stays local. */
    saveStarted(state, { payload }: PayloadAction<{ id: string; sent: NoteChanges }>) {
      const entry = state[payload.id];
      if (!entry) return;
      const keep: NoteChanges = { ...entry.edits };
      for (const key of Object.keys(payload.sent) as (keyof NoteChanges)[]) delete keep[key];
      entry.edits = keep;
      entry.inFlight = payload.sent;
      entry.status = 'saving';
      entry.message = null;
    },
    saveSucceeded(
      state,
      { payload }: PayloadAction<{ id: string; revision: number; savedAt: string }>,
    ) {
      const entry = state[payload.id];
      if (!entry) return;
      entry.inFlight = null;
      entry.revision = payload.revision;
      entry.status = 'saved';
      entry.savedAt = payload.savedAt;
      entry.retries = 0;
    },
    /** The sent changes are kept (under anything typed since) to be sent again. */
    saveFailed(
      state,
      {
        payload,
      }: PayloadAction<{
        id: string;
        status: Exclude<SaveStatus, 'idle' | 'saving' | 'saved'>;
        message?: string;
      }>,
    ) {
      const entry = state[payload.id];
      if (!entry) return;
      entry.edits = mergeChanges(entry.inFlight ?? {}, entry.edits);
      entry.inFlight = null;
      entry.status = payload.status;
      entry.message = payload.message ?? null;
      entry.retries = payload.status === 'offline' ? entry.retries + 1 : 0;
    },
    /** "Reload latest": local edits are dropped and the server's revision is taken. */
    discarded(state, { payload }: PayloadAction<{ id: string; revision: number }>) {
      state[payload.id] = empty(payload.revision);
    },
    /** The note was signed or left: forget it. */
    closed(state, { payload }: PayloadAction<{ id: string }>) {
      delete state[payload.id];
    },
  },
  // Patient data of the previous user: dropped on logout.
  extraReducers: (builder) => builder.addCase(loggedOut, () => ({})),
});

export const { opened, edited, saveStarted, saveSucceeded, saveFailed, discarded, closed } =
  slice.actions;
export default slice.reducer;
