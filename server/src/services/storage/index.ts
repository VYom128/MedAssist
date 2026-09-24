import { config } from '../../config/env.js';
import { localStorage } from './local.js';
import type { StorageAdapter } from './types.js';

export type { StorageAdapter } from './types.js';

/** Drivers that come with Phase 11: every call fails until they are configured. */
function notConfigured(driver: 's3' | 'cloudinary'): StorageAdapter {
  const fail = async (): Promise<never> => {
    throw new Error(`Storage driver "${driver}" is not configured`);
  };
  return { driver, init: fail, save: fail, createReadStream: fail, remove: fail };
}

let adapter: StorageAdapter | null = null;

/** The storage adapter for STORAGE_DRIVER (one per process). */
export function getStorage(): StorageAdapter {
  adapter ??=
    config.storage.driver === 'local'
      ? localStorage(config.storage.uploadDir)
      : notConfigured(config.storage.driver);
  return adapter;
}

/** Creates the upload directory at start-up (local driver). */
export async function initStorage(): Promise<void> {
  await getStorage().init();
}

export { notConfigured as notConfiguredStorage };
