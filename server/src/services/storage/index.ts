import { config } from '../../config/env.js';
import { cloudinaryStorage } from './cloudinary.js';
import { localStorage } from './local.js';
import type { StorageAdapter } from './types.js';

export type { StorageAdapter } from './types.js';

/** A driver that is not available (s3; cloudinary without settings): every call fails. */
function notConfigured(driver: 's3' | 'cloudinary'): StorageAdapter {
  const fail = async (): Promise<never> => {
    throw new Error(`Storage driver "${driver}" is not configured`);
  };
  return { driver, init: fail, save: fail, createReadStream: fail, remove: fail };
}

let adapter: StorageAdapter | null = null;

function createAdapter(): StorageAdapter {
  const { driver, uploadDir, cloudinary } = config.storage;
  if (driver === 'local') return localStorage(uploadDir);
  // env.ts refuses cloudinary without its settings, so this is only a fallback.
  if (
    driver === 'cloudinary' &&
    cloudinary.cloudName &&
    cloudinary.apiKey &&
    cloudinary.apiSecret
  ) {
    return cloudinaryStorage({
      cloudName: cloudinary.cloudName,
      apiKey: cloudinary.apiKey,
      apiSecret: cloudinary.apiSecret,
      folder: cloudinary.folder,
    });
  }
  return notConfigured(driver);
}

/** The storage adapter for STORAGE_DRIVER (one per process). */
export function getStorage(): StorageAdapter {
  adapter ??= createAdapter();
  return adapter;
}

/** Creates the upload directory at start-up (local driver). */
export async function initStorage(): Promise<void> {
  await getStorage().init();
}

export { notConfigured as notConfiguredStorage };
