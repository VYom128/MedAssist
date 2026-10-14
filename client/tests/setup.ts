import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from './msw/server';

// jsdom has no Web Animations API; Headless UI transitions only need an empty list.
Element.prototype.getAnimations ??= () => [];
// Nor ResizeObserver (Headless UI combobox) or elementFromPoint (react-big-calendar selection).
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
document.elementFromPoint ??= () => null;

// These are full-page tests (router, store, app shell) and CPU-bound: the first render of a file
// alone takes ~1 s. findBy/waitFor wait up to 3 s (default 1 s) so a busy CI runner does not
// fail them; they still return as soon as the UI is ready (vitest.config: 15 s per test).
configure({ asyncUtilTimeout: 3000 });

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());
