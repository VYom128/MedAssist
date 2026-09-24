import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
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

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());
