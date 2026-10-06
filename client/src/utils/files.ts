import { UPLOAD_RULES } from '../constants/catalog';

const MB = 1024 * 1024;

export const formatFileSize = (bytes: number) =>
  bytes >= MB ? `${(bytes / MB).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/**
 * The client-side check of an upload (mirrors the server, which checks the bytes and decides):
 * PDF, JPG or PNG by type or extension, at most UPLOAD_RULES.maxMb. Returns a message or null.
 */
export function checkUploadFile(file: File): string | null {
  const name = file.name.toLowerCase();
  const typeOk =
    (UPLOAD_RULES.mimeTypes as readonly string[]).includes(file.type) ||
    UPLOAD_RULES.extensions.some((ext) => name.endsWith(ext));
  if (!typeOk) return 'Only PDF, JPG and PNG files can be uploaded.';
  if (file.size > UPLOAD_RULES.maxMb * MB) {
    return `This file is ${formatFileSize(file.size)}. Files can be at most ${UPLOAD_RULES.maxMb} MB.`;
  }
  if (file.size === 0) return 'This file is empty.';
  return null;
}
