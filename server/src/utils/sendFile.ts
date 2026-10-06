import type { Response } from 'express';
import type { Readable } from 'node:stream';
import { attachmentHeader } from './files.js';
import { logger, serializeError } from './logger.js';

/**
 * Streams a stored file as a download (spec §10.3): the stored type, `attachment` with a safe
 * name, no sniffing, never cached.
 */
export function sendFile(
  res: Response,
  file: { stream: Readable; mimeType: string; fileName: string; sizeBytes: number },
) {
  res.status(200);
  res.setHeader('Content-Type', file.mimeType);
  res.setHeader('Content-Length', String(file.sizeBytes));
  res.setHeader('Content-Disposition', attachmentHeader(file.fileName));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  file.stream.on('error', (err) => {
    logger.error({ err: serializeError(err) }, 'File stream failed');
    res.destroy(err);
  });
  file.stream.pipe(res);
}
