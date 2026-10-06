import type { RequestHandler } from 'express';
import multer from 'multer';
import { ERROR_CODES } from '../config/constants.js';
import { config } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

const parser = multer({
  // In memory: the bytes are type-checked and hashed before anything is written to storage.
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.storage.maxUploadBytes,
    files: 1,
    fields: 10,
    fieldSize: 2048,
    parts: 12,
  },
}).single('file');

/**
 * One uploaded file in the `file` field (multipart/form-data), kept in memory. Over the size
 * limit → 413 FILE_TOO_LARGE; other multipart problems → 400.
 */
export const singleFile: RequestHandler = (req, res, next) => {
  parser(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        const mb = Math.round(config.storage.maxUploadBytes / (1024 * 1024));
        return next(new ApiError(413, `Files can be at most ${mb} MB`, ERROR_CODES.FILE_TOO_LARGE));
      }
      return next(ApiError.badRequest('Send one file in the "file" field with the form fields'));
    }
    return next(err);
  });
};
