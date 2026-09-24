import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { loggedOut } from '../auth/authSlice';
import { BLOCKED, type SaveStatus } from '../encounters/consultDraftSlice';
import type { RxLocal } from './rows';

/**
 * Unsaved prescription edits per note (memory only, like consultDraft). `local` is the whole
 * edited prescription (null = nothing pending: show the server's); `seq` counts edits so a save
 * that returns after newer edits does not clear them; `revision` is the draft's version (null
 * while no draft exists).
 */
export interface RxDraftEntry {
  local: RxLocal | null;
  seq: number;
  sending: number | null;
  revision: number | null;
  status: SaveStatus;
  savedAt: string | null;
  message: string | null;
  retries: number;
}

const empty = (revision: number | null): RxDraftEntry => ({
  local: null,
  seq: 0,
  sending: null,
  revision,
  status: 'idle',
  savedAt: null,
  message: null,
  retries: 0,
});

const slice = createSlice({
  name: 'rxDraft',
  initialState: {} as Record<string, RxDraftEntry>,
  reducers: {
    rxOpened(state, { payload }: PayloadAction<{ id: string; revision: number | null }>) {
      const e = state[payload.id];
      if (!e) state[payload.id] = empty(payload.revision);
      else if (!e.local && e.sending === null && !BLOCKED.includes(e.status)) {
        e.revision = payload.revision;
      }
    },
    rxEdited(state, { payload }: PayloadAction<{ id: string; local: RxLocal }>) {
      const e = state[payload.id];
      if (!e) return;
      e.local = payload.local;
      e.seq += 1;
      if (e.status === 'saved' || e.status === 'error') e.status = 'idle';
    },
    rxSaveStarted(state, { payload }: PayloadAction<{ id: string }>) {
      const e = state[payload.id];
      if (!e) return;
      e.sending = e.seq;
      e.status = 'saving';
      e.message = null;
    },
    rxSaveSucceeded(
      state,
      { payload }: PayloadAction<{ id: string; revision: number; savedAt: string }>,
    ) {
      const e = state[payload.id];
      if (!e) return;
      if (e.sending === e.seq) e.local = null;
      e.sending = null;
      e.revision = payload.revision;
      e.status = 'saved';
      e.savedAt = payload.savedAt;
      e.retries = 0;
    },
    rxSaveFailed(
      state,
      {
        payload,
      }: PayloadAction<{
        id: string;
        status: Exclude<SaveStatus, 'idle' | 'saving' | 'saved'>;
        message?: string;
      }>,
    ) {
      const e = state[payload.id];
      if (!e) return;
      e.sending = null;
      e.status = payload.status;
      e.message = payload.message ?? null;
      e.retries = payload.status === 'offline' ? e.retries + 1 : 0;
    },
    rxDiscarded(state, { payload }: PayloadAction<{ id: string; revision: number | null }>) {
      state[payload.id] = empty(payload.revision);
    },
    rxClosed(state, { payload }: PayloadAction<{ id: string }>) {
      delete state[payload.id];
    },
  },
  extraReducers: (builder) => builder.addCase(loggedOut, () => ({})),
});

export const {
  rxOpened,
  rxEdited,
  rxSaveStarted,
  rxSaveSucceeded,
  rxSaveFailed,
  rxDiscarded,
  rxClosed,
} = slice.actions;
export default slice.reducer;
