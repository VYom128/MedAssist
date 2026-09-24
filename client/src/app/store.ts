import { combineReducers, configureStore, createListenerMiddleware } from '@reduxjs/toolkit';
import authReducer, { loggedOut } from '../features/auth/authSlice';
import consultDraftReducer from '../features/encounters/consultDraftSlice';
import rxDraftReducer from '../features/prescriptions/rxDraftSlice';
import { apiSlice } from './apiSlice';

const rootReducer = combineReducers({
  auth: authReducer,
  /** Unsaved clinical note edits – memory only (spec §13.2). */
  consultDraft: consultDraftReducer,
  rxDraft: rxDraftReducer,
  [apiSlice.reducerPath]: apiSlice.reducer,
});

export type RootState = ReturnType<typeof rootReducer>;

/** Creates a store; tests pass `preloadedState` for a logged-in user. */
export function makeStore(preloadedState?: Partial<RootState>) {
  // Cached server data belongs to the previous user: drop it on logout.
  const listener = createListenerMiddleware();
  listener.startListening({
    actionCreator: loggedOut,
    effect: (_action, api) => {
      api.dispatch(apiSlice.util.resetApiState());
    },
  });

  return configureStore({
    reducer: rootReducer,
    preloadedState,
    middleware: (getDefault) =>
      getDefault().prepend(listener.middleware).concat(apiSlice.middleware),
  });
}

export const store = makeStore();

export type AppStore = ReturnType<typeof makeStore>;
export type AppDispatch = AppStore['dispatch'];
