import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv({ quiet: true });

const NODE_ENVS = ['development', 'test', 'production'] as const;

const isTestEnv = process.env.NODE_ENV === 'test';
// Tests connect to an in-memory replica set, so MONGO_URI is only required outside test.
const mongoUriRequired = !isTestEnv;

/** Secrets are required outside test; tests get a fixed placeholder so they need no .env. */
const secret = (name: string) =>
  isTestEnv
    ? z.string().min(32).default(`test-only-${name.toLowerCase()}-0123456789abcdef`)
    : z.string({ error: 'Required' }).min(32, 'Must be at least 32 characters');

/** "true"/"false" strings (z.coerce.boolean would treat "false" as true). */
const booleanString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

/** Parses a duration like "900s", "15m", "12h" or "7d" into seconds. */
const durationSeconds = z
  .string()
  .regex(/^\d+[smhd]$/, 'Use a number followed by s, m, h or d (e.g. 15m)')
  .transform((v) => {
    const n = Number(v.slice(0, -1));
    const unit = { s: 1, m: 60, h: 3600, d: 86_400 }[v.slice(-1) as 's' | 'm' | 'h' | 'd'];
    return n * unit;
  })
  .refine((v) => v > 0, 'Must be greater than zero');

const envSchema = z
  .object({
    NODE_ENV: z.enum(NODE_ENVS).default('development'),
    PORT: z.coerce.number().int().positive().default(5000),
    MONGO_URI: mongoUriRequired
      ? z.string({ error: 'Required' }).trim().min(1, 'Required')
      : z.string().trim().min(1).optional(),
    CLIENT_URL: z.url().default('http://localhost:5173'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    RATE_LIMIT_WINDOW_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(15 * 60 * 1000),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),

    // Auth (spec §10.1). The refresh token is random bytes stored hashed, so it needs no secret.
    JWT_ACCESS_SECRET: secret('JWT_ACCESS_SECRET'),
    JWT_ACCESS_EXPIRES_IN: durationSeconds.default(15 * 60),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().max(90).default(7),
    COOKIE_SECURE: booleanString,
    COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
    BCRYPT_ROUNDS: z.coerce
      .number()
      .int()
      .min(4)
      .max(15)
      .default(isTestEnv ? 4 : 12),

    // Audit hash chain (spec §10.5)
    AUDIT_HASH_SECRET: secret('AUDIT_HASH_SECRET'),

    // Email: "console" prints recipient, subject and links to the log (dev/test only); "smtp" sends.
    EMAIL_TRANSPORT: z.enum(['console', 'smtp']).default('console'),
    SMTP_HOST: z.string().trim().min(1).optional(),
    SMTP_PORT: z.coerce.number().int().positive().optional(),
    SMTP_USER: z.string().trim().min(1).optional(),
    SMTP_PASS: z.string().min(1).optional(),
    MAIL_FROM: z.string().trim().min(1).optional(),

    // Queue board kiosk (spec §7.9): the key in /queue-board?key=… and the kiosk socket. Unset
    // = the board is switched off.
    KIOSK_KEY: z.string().trim().min(24, 'Must be at least 24 characters').optional(),
  })
  .superRefine((env, ctx) => {
    if (env.COOKIE_SAMESITE === 'none' && !env.COOKIE_SECURE) {
      ctx.addIssue({
        code: 'custom',
        path: ['COOKIE_SAMESITE'],
        message: 'SameSite=none requires COOKIE_SECURE=true',
      });
    }
    if (env.NODE_ENV === 'production' && !env.COOKIE_SECURE) {
      ctx.addIssue({
        code: 'custom',
        path: ['COOKIE_SECURE'],
        message: 'Must be true in production (the refresh cookie needs HTTPS)',
      });
    }
    if (env.NODE_ENV === 'production' && env.EMAIL_TRANSPORT !== 'smtp') {
      ctx.addIssue({
        code: 'custom',
        path: ['EMAIL_TRANSPORT'],
        message: 'Must be smtp in production (console prints reset links)',
      });
    }
    if (env.EMAIL_TRANSPORT === 'smtp') {
      for (const key of ['SMTP_HOST', 'SMTP_PORT', 'MAIL_FROM'] as const) {
        if (env[key] === undefined) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: 'Required when EMAIL_TRANSPORT=smtp',
          });
        }
      }
    }
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
  auth: Object.freeze({
    accessSecret: env.JWT_ACCESS_SECRET,
    /** Access token lifetime in seconds. */
    accessExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
    refreshTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
    bcryptRounds: env.BCRYPT_ROUNDS,
  }),
  cookie: Object.freeze({ secure: env.COOKIE_SECURE, sameSite: env.COOKIE_SAMESITE }),
  audit: Object.freeze({ hashSecret: env.AUDIT_HASH_SECRET }),
  email: Object.freeze({
    transport: env.EMAIL_TRANSPORT,
    from: env.MAIL_FROM ?? 'MedAssist <no-reply@medassist.dev>',
    smtp: Object.freeze({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    }),
  }),
  kiosk: Object.freeze({ key: env.KIOSK_KEY }),
});

export type Config = typeof config;
