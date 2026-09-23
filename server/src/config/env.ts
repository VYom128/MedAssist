import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv({ quiet: true });

const NODE_ENVS = ['development', 'test', 'production'] as const;

// Tests connect to an in-memory replica set, so MONGO_URI is only required outside test.
const mongoUriRequired = process.env.NODE_ENV !== 'test';

const envSchema = z.object({
  NODE_ENV: z.enum(NODE_ENVS).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  MONGO_URI: mongoUriRequired
    ? z.string({ error: 'Required' }).trim().min(1, 'Required')
    : z.string().trim().min(1).optional(),
  CLIENT_URL: z.url().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  RATE_LIMIT_WINDOW_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 60 * 1000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // The logger depends on config, so report with console and stop before anything else starts.
  // Only variable names and reasons are printed – never values (they may be secrets).
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  console.error('Set them in server/.env (see server/.env.example).');
  process.exit(1);
}

const env = parsed.data;

/** Validated, read-only application configuration. */
export const config = Object.freeze({
  nodeEnv: env.NODE_ENV,
  isProd: env.NODE_ENV === 'production',
  isDev: env.NODE_ENV === 'development',
  isTest: env.NODE_ENV === 'test',
  port: env.PORT,
  mongoUri: env.MONGO_URI,
  clientUrl: env.CLIENT_URL,
  logLevel: env.LOG_LEVEL,
  rateLimit: Object.freeze({ windowMs: env.RATE_LIMIT_WINDOW_MS, max: env.RATE_LIMIT_MAX }),
});

export type Config = typeof config;
