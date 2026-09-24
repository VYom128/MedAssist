import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ApiError } from '../../utils/ApiError.js';
import type { StorageAdapter } from './types.js';

const EXTENSIONS: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
};

/** Keys look like '2026/09/<uuid>.pdf' – nothing else is accepted (no path traversal). */
const KEY_PATTERN = /^\d{4}\/\d{2}\/[0-9a-f-]{36}\.(pdf|jpg|png)$/;

/**
 * Local disk storage: random file names in year/month folders under `root` (UPLOAD_DIR). Files
 * are written 0600 and never served statically – downloads stream through the API.
 */
export function localStorage(root: string): StorageAdapter {
  const fullPath = (key: string) => {
    if (!KEY_PATTERN.test(key)) throw ApiError.notFound('File not found');
    return path.join(root, ...key.split('/'));
  };
  return {
    driver: 'local',
    async init() {
      await mkdir(root, { recursive: true, mode: 0o700 });
    },
    async save(buffer, { mimeType }) {
      const now = new Date();
      const folder = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
      const storageKey = `${folder}/${randomUUID()}${EXTENSIONS[mimeType] ?? '.pdf'}`;
      await mkdir(path.join(root, ...folder.split('/')), { recursive: true, mode: 0o700 });
      await writeFile(fullPath(storageKey), buffer, { mode: 0o600, flag: 'wx' });
      return { storageKey };
    },
    async createReadStream(storageKey) {
      const file = fullPath(storageKey);
      try {
        await access(file);
      } catch {
        throw ApiError.notFound('File not found');
      }
      return createReadStream(file);
    },
    async remove(storageKey) {
      if (!KEY_PATTERN.test(storageKey)) return;
      await rm(fullPath(storageKey), { force: true });
    },
  };
}
