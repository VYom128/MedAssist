import type { Readable } from 'node:stream';

/** Where file bytes live (spec §6.23 `storageDriver` + `storageKey`). */
export interface StorageAdapter {
  readonly driver: 'local' | 's3' | 'cloudinary';
  /** Stores the bytes under a new random key (never derived from the original name). */
  save(
    buffer: Buffer,
    meta: { mimeType: string; originalName: string },
  ): Promise<{ storageKey: string }>;
  /** A stream of the stored bytes; rejects with NotFound when the key is unknown. */
  createReadStream(storageKey: string): Promise<Readable>;
  /** Removes stored bytes (orphans after a failed transaction, seed reset). Missing = fine. */
  remove(storageKey: string): Promise<void>;
  /** Prepares the backend (the local driver creates its directory). */
  init(): Promise<void>;
}
