import { pino, type LoggerOptions } from 'pino';
import { env, isTest } from '../config/env.js';

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
  level: isTest ? 'silent' : env.LOG_LEVEL,
  redact: { paths: redactPaths, censor: '[REDACTED]' },
  base: { service: 'med-assist-api' },
  timestamp: pino.stdTimeFunctions.isoTime,
};

if (env.NODE_ENV === 'development') {
  // pino-pretty is a devDependency: only referenced in development.
  options.transport = {
    target: 'pino-pretty',
    options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname,service' },
  };
}

export const logger = pino(options);
