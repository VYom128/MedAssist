import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { ApiError } from '../../utils/ApiError.js';
import type { StorageAdapter } from './types.js';

/**
 * Cloudinary storage (production, spec §12.2, D201) over its REST API with plain `fetch` – no SDK.
 * Every file is a **raw** asset of delivery type **authenticated**, so it has no public URL: the
 * API downloads it with a short-lived signed request and streams it to the user through the
 * authorised download endpoints (the browser never sees a Cloudinary address). Only the public id
 * is stored (`storageKey`, like `medassist/2026/10/<uuid>.pdf` – random, never the file name).
 * Generated PDFs go through `save` like uploads.
 */

export interface CloudinaryOptions {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
  /** Folder for every public id, e.g. 'medassist'. */
  folder: string;
}

type Fetch = typeof fetch;
type Params = Record<string, string | number | boolean>;

const EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

/** Download links are valid this long; the API uses them at once. */
const DOWNLOAD_TTL_SECONDS = 60;

/**
 * Cloudinary's request signature: the parameters sorted by name as `name=value` joined with `&`,
 * the API secret appended, SHA-1 in hex. (`file`, `api_key`, `resource_type` and `cloud_name` are
 * never signed.)
 */
export function signParams(params: Params, apiSecret: string): string {
  const toSign = Object.keys(params)
    .filter((k) => !['file', 'api_key', 'resource_type', 'cloud_name'].includes(k))
    .sort()
    .map((k) => `${k}=${String(params[k])}`)
    .join('&');
  return createHash('sha1')
    .update(toSign + apiSecret)
    .digest('hex');
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

export function cloudinaryStorage(
  options: CloudinaryOptions,
  deps: { fetch?: Fetch; now?: () => number } = {},
): StorageAdapter {
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const base = `https://api.cloudinary.com/v1_1/${encodeURIComponent(options.cloudName)}/raw`;
  // Keys look like '<folder>/2026/10/<uuid>.pdf' – nothing else is accepted.
  const keyPattern = new RegExp(
    `^${escapeRegex(options.folder)}/\\d{4}/\\d{2}/[0-9a-f-]{36}\\.(pdf|jpg|png)$`,
  );
  const timestamp = () => Math.floor(now() / 1000);
  const signed = (params: Params) => ({
    ...params,
    api_key: options.apiKey,
    signature: signParams(params, options.apiSecret),
  });
  const form = (fields: Params) => {
    const body = new FormData();
    for (const [k, v] of Object.entries(fields)) body.append(k, String(v));
    return body;
  };

  return {
    driver: 'cloudinary',

    async init() {
      // Nothing to prepare: the folder is part of every public id.
    },

    async save(buffer, { mimeType }) {
      const at = new Date(now());
      const folder = `${options.folder}/${at.getUTCFullYear()}/${String(at.getUTCMonth() + 1).padStart(2, '0')}`;
      const publicId = `${folder}/${randomUUID()}.${EXTENSIONS[mimeType] ?? 'pdf'}`;
      const body = form(
        signed({
          public_id: publicId,
          type: 'authenticated',
          overwrite: false,
          timestamp: timestamp(),
        }),
      );
      body.append('file', new Blob([new Uint8Array(buffer)], { type: mimeType }), 'file');
      const res = await doFetch(`${base}/upload`, { method: 'POST', body });
      if (!res.ok) throw new Error(`Cloudinary upload failed (HTTP ${res.status})`);
      const json = (await res.json()) as { public_id?: string };
      if (json.public_id !== publicId) throw new Error('Cloudinary upload returned another id');
      return { storageKey: publicId };
    },

    async createReadStream(storageKey) {
      if (!keyPattern.test(storageKey)) throw ApiError.notFound('File not found');
      const ts = timestamp();
      const query = new URLSearchParams(
        Object.entries(
          signed({
            public_id: storageKey,
            type: 'authenticated',
            attachment: false,
            expires_at: ts + DOWNLOAD_TTL_SECONDS,
            timestamp: ts,
          }),
        ).map(([k, v]): [string, string] => [k, String(v)]),
      );
      const res = await doFetch(`${base}/download?${query.toString()}`);
      if (res.status === 404) throw ApiError.notFound('File not found');
      if (!res.ok || !res.body) throw new Error(`Cloudinary download failed (HTTP ${res.status})`);
      return Readable.fromWeb(res.body as WebReadableStream<Uint8Array>);
    },

    async remove(storageKey) {
      if (!keyPattern.test(storageKey)) return;
      const res = await doFetch(`${base}/destroy`, {
        method: 'POST',
        body: form(
          signed({
            public_id: storageKey,
            type: 'authenticated',
            invalidate: true,
            timestamp: timestamp(),
          }),
        ),
      });
      // "not found" is fine (already gone); anything else is an error.
      if (!res.ok) throw new Error(`Cloudinary delete failed (HTTP ${res.status})`);
    },
  };
}
