import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileTypeFromBuffer } from 'file-type';
import {
  DOCUMENT_RULES,
  ERROR_CODES,
  UPLOAD_MIME_TYPES,
  type UploadMimeType,
} from '../config/constants.js';
import { ApiError } from './ApiError.js';

const EXTENSIONS: Record<UploadMimeType, string> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
};

/**
 * The file's real type from its first bytes (spec §10.3) – the name and the client's
 * Content-Type are never trusted. Anything but PDF, JPEG or PNG → 415 UNSUPPORTED_FILE_TYPE.
 */
export async function detectUploadType(buffer: Buffer): Promise<UploadMimeType> {
  const detected = await fileTypeFromBuffer(buffer);
  const mime = detected?.mime as UploadMimeType | undefined;
  if (!mime || !(UPLOAD_MIME_TYPES as readonly string[]).includes(mime)) {
    throw new ApiError(
      415,
      'Only PDF, JPG and PNG files can be uploaded',
      ERROR_CODES.UNSUPPORTED_FILE_TYPE,
    );
  }
  return mime;
}

export const sha256 = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');

/**
 * A display/download name that is safe everywhere: no folders, only letters, digits, spaces,
 * dots, dashes and underscores, at most 120 characters, and the extension of the REAL type.
 */
export function safeFileName(name: string | undefined, mimeType: UploadMimeType): string {
  const ext = EXTENSIONS[mimeType];
  const base = path
    .basename((name ?? '').replace(/\\/g, '/'))
    .normalize('NFKD')
    .replace(/\.[^.]*$/, '')
    .replace(/[^A-Za-z0-9 ._-]+/g, '_')
    .replace(/[\s_]{2,}/g, '_')
    .replace(/^[._\s-]+|[._\s-]+$/g, '')
    .slice(0, DOCUMENT_RULES.originalNameMax - ext.length);
  return `${base || 'document'}${ext}`;
}

/** `Content-Disposition: attachment` for a name made by safeFileName (ASCII only). */
export const attachmentHeader = (fileName: string) =>
  `attachment; filename="${fileName.replace(/["\\]/g, '_')}"`;
