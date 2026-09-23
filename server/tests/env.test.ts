import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const serverDir = fileURLToPath(new URL('..', import.meta.url));

/** Loads config/env.ts in a child process with a clean environment (no .env influence on failures). */
async function loadEnv(vars: Record<string, string>) {
  const script =
    "const { config } = await import('./src/config/env.ts'); console.log(JSON.stringify(config));";
  try {
    const { stdout } = await run(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '-e', script],
      {
        cwd: serverDir,
        // DOTENV_CONFIG_PATH points dotenv at a file that does not exist, so only `vars` apply.
        env: { PATH: process.env.PATH ?? '', DOTENV_CONFIG_PATH: '/nonexistent/.env', ...vars },
      },
    );
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { code: number; stdout: string; stderr: string };
    return { code: e.code, stdout: e.stdout, stderr: e.stderr };
  }
}

const SECRETS = {
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  AUDIT_HASH_SECRET: 'b'.repeat(32),
};

describe('config/env', () => {
  it('applies defaults and exposes a frozen config', async () => {
    const res = await loadEnv({ MONGO_URI: 'mongodb://127.0.0.1:27017/x', ...SECRETS });
    expect(res.code).toBe(0);
    expect(JSON.parse(res.stdout)).toMatchObject({
      nodeEnv: 'development',
      isDev: true,
      isProd: false,
      port: 5000,
      clientUrl: 'http://localhost:5173',
      logLevel: 'info',
      auth: { accessExpiresIn: 900, refreshTtlDays: 7, bcryptRounds: 12 },
      cookie: { secure: false, sameSite: 'lax' },
      email: { transport: 'console' },
    });
  });

  it('parses JWT_ACCESS_EXPIRES_IN durations into seconds', async () => {
    const res = await loadEnv({
      MONGO_URI: 'mongodb://127.0.0.1:27017/x',
      ...SECRETS,
      JWT_ACCESS_EXPIRES_IN: '2h',
    });
    expect(JSON.parse(res.stdout)).toMatchObject({ auth: { accessExpiresIn: 7200 } });
  });

  it('requires secrets outside test', async () => {
    const res = await loadEnv({ MONGO_URI: 'mongodb://127.0.0.1:27017/x' });
    expect(res.code).toBe(1);
    expect(res.stderr).toContain('JWT_ACCESS_SECRET');
    expect(res.stderr).toContain('AUDIT_HASH_SECRET');
  });

  it('rejects SameSite=none without Secure and smtp without its settings', async () => {
    const res = await loadEnv({
      MONGO_URI: 'mongodb://127.0.0.1:27017/x',
      ...SECRETS,
      COOKIE_SAMESITE: 'none',
      COOKIE_SECURE: 'false',
      EMAIL_TRANSPORT: 'smtp',
    });
    expect(res.code).toBe(1);
    for (const name of ['COOKIE_SAMESITE', 'SMTP_HOST', 'SMTP_PORT', 'MAIL_FROM']) {
      expect(res.stderr).toContain(name);
    }
  });

  it('refuses the console email transport in production', async () => {
    const res = await loadEnv({
      NODE_ENV: 'production',
      MONGO_URI: 'mongodb://127.0.0.1:27017/x',
      ...SECRETS,
    });
    expect(res.code).toBe(1);
    expect(res.stderr).toContain('EMAIL_TRANSPORT');
  });

  it('does not require MONGO_URI in test', async () => {
    const res = await loadEnv({ NODE_ENV: 'test' });
    expect(res.code).toBe(0);
    expect(JSON.parse(res.stdout)).toMatchObject({ isTest: true });
  });

  it('exits with code 1 and lists invalid variables without printing their values', async () => {
    const res = await loadEnv({
      NODE_ENV: 'production',
      PORT: 'not-a-port-secret123',
      CLIENT_URL: 'bad-url-secret456',
      LOG_LEVEL: 'loud',
    });
    expect(res.code).toBe(1);
    for (const name of ['MONGO_URI', 'PORT', 'CLIENT_URL', 'LOG_LEVEL']) {
      expect(res.stderr).toContain(name);
    }
    expect(res.stderr).not.toContain('secret123');
    expect(res.stderr).not.toContain('secret456');
    expect(res.stderr).not.toContain('loud');
  });
});
