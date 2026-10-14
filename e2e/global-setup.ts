import { startStack } from './stack';

/** Starts the throwaway stack once for the run; Playwright calls the returned teardown at the end. */
export default async function globalSetup() {
  return startStack();
}
