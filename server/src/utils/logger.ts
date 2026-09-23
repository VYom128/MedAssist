import { pino, type LoggerOptions } from 'pino';
import { config } from '../config/env.js';

/**
 * Never log request bodies, passwords, tokens or patient data.
 * pino-http does not log bodies; these paths cover headers and any accidental object logging.
 */
const redactPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
];

const options: LoggerOptions = {
  // Development: pretty; production: JSON to stdout; test: silent.
  level: config.isTest ? 'silent' : config.logLevel,
  redact: { paths: redactPaths, censor: '[REDACTED]' },
  base: { service: 'med-assist-api' },
  timestamp: pino.stdTimeFunctions.isoTime,
};

if (config.isDev) {
  // pino-pretty is a devDependency: only referenced in development.
  options.transport = {
    target: 'pino-pretty',
    options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname,service' },
  };
}

/** Application logger. Use this instead of console. */
export const logger = pino(options);

/**
 * Reduces any thrown value to `{ name, message, stack }` for logging.
 * Raw error objects can carry request data as properties (body-parser's `body`,
 * Mongo duplicate-key `keyValue`), which must never reach the logs.
 */
export function serializeError(err: unknown): { name: string; message: string; stack?: string } {
  if (err instanceof Error) return { name: err.name, message: err.message, stack: err.stack };
  return { name: 'NonError', message: typeof err === 'string' ? err : 'Non-error value thrown' };
}
