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
  // Test values only (not used anywhere else): long and varied enough to pass looksWeak.
  JWT_ACCESS_SECRET: 'test-jwt-0123456789abcdefghijklmnopq',
  AUDIT_HASH_SECRET: 'test-audit-0123456789abcdefghijklmno',
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

  it('trusts one proxy hop by default; TRUST_PROXY=4 for the Vercel rewrite to Render', async () => {
    const base = { MONGO_URI: 'mongodb://127.0.0.1:27017/x', ...SECRETS };
    expect(JSON.parse((await loadEnv(base)).stdout)).toMatchObject({ trustProxy: 1 });
    expect(JSON.parse((await loadEnv({ ...base, TRUST_PROXY: '4' })).stdout)).toMatchObject({
      trustProxy: 4,
    });
    expect((await loadEnv({ ...base, TRUST_PROXY: 'yes' })).code).toBe(1);
  });

  it('treats empty values as unset (blank optional variables on a host)', async () => {
    const res = await loadEnv({
      MONGO_URI: 'mongodb://127.0.0.1:27017/x',
      ...SECRETS,
      KIOSK_KEY: '',
      SMTP_USER: '',
      LOG_LEVEL: '',
    });
    expect(res.code).toBe(0);
    expect(JSON.parse(res.stdout)).toMatchObject({ kiosk: {}, logLevel: 'info' });
  });

  it('rejects weak or placeholder secrets', async () => {
    const base = { MONGO_URI: 'mongodb://127.0.0.1:27017/x', ...SECRETS };
    for (const weak of [
      'a'.repeat(40),
      '<generate-me>-0123456789abcdefghijklmnop',
      'my-super-secret-value-0123456789abcd',
    ]) {
      const res = await loadEnv({ ...base, JWT_ACCESS_SECRET: weak });
      expect(res.code, weak).toBe(1);
      expect(res.stderr).toContain('JWT_ACCESS_SECRET: Looks like a placeholder');
      expect(res.stderr).not.toContain(weak); // values are never printed
    }
  });

  it('cloudinary needs its three settings; s3 is not available', async () => {
    const base = { MONGO_URI: 'mongodb://127.0.0.1:27017/x', ...SECRETS };
    const cloud = await loadEnv({ ...base, STORAGE_DRIVER: 'cloudinary' });
    expect(cloud.code).toBe(1);
    for (const key of ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']) {
      expect(cloud.stderr).toContain(`${key}: Required when STORAGE_DRIVER=cloudinary`);
    }
    const ok = await loadEnv({
      ...base,
      STORAGE_DRIVER: 'cloudinary',
      CLOUDINARY_CLOUD_NAME: 'demo-cloud',
      CLOUDINARY_API_KEY: '123456789012345',
      CLOUDINARY_API_SECRET: 'test-cloudinary-0123456789',
    });
    expect(ok.code).toBe(0);
    expect(JSON.parse(ok.stdout)).toMatchObject({
      storage: {
        driver: 'cloudinary',
        cloudinary: { cloudName: 'demo-cloud', folder: 'medassist' },
      },
    });
    expect((await loadEnv({ ...base, STORAGE_DRIVER: 's3' })).stderr).toContain(
      'The s3 driver is not available',
    );
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

  it('refuses the console email transport and insecure cookies in production', async () => {
    const res = await loadEnv({
      NODE_ENV: 'production',
      MONGO_URI: 'mongodb://127.0.0.1:27017/x',
      ...SECRETS,
    });
    expect(res.code).toBe(1);
    expect(res.stderr).toContain('EMAIL_TRANSPORT');
    expect(res.stderr).toContain('COOKIE_SECURE');
    // Defaults that only make sense locally fail fast too.
    expect(res.stderr).toContain('CLIENT_URL: Must be the deployed https:// client URL');
    expect(res.stderr).toContain('STORAGE_DRIVER: Must not be local in production');
  });

  it('in production: an http or localhost CLIENT_URL and SMTP without a login are refused', async () => {
    const res = await loadEnv({
      NODE_ENV: 'production',
      MONGO_URI: 'mongodb://127.0.0.1:27017/x',
      ...SECRETS,
      CLIENT_URL: 'http://medassist.example.com',
      COOKIE_SECURE: 'true',
      STORAGE_DRIVER: 'cloudinary',
      EMAIL_TRANSPORT: 'smtp',
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '587',
      MAIL_FROM: 'MedAssist <no-reply@example.com>',
    });
    expect(res.code).toBe(1);
    expect(res.stderr).toContain('CLIENT_URL');
    expect(res.stderr).toContain('SMTP_USER: Required for SMTP in production');
    expect(res.stderr).toContain('SMTP_PASS: Required for SMTP in production');
  });

  it('starts in production with smtp and secure cookies', async () => {
    const res = await loadEnv({
      NODE_ENV: 'production',
      MONGO_URI: 'mongodb://127.0.0.1:27017/x',
      ...SECRETS,
      CLIENT_URL: 'https://medassist.example.com',
      COOKIE_SECURE: 'true',
      COOKIE_SAMESITE: 'none',
      STORAGE_DRIVER: 'cloudinary',
      CLOUDINARY_CLOUD_NAME: 'demo-cloud',
      CLOUDINARY_API_KEY: '123456789012345',
      CLOUDINARY_API_SECRET: 'test-cloudinary-0123456789',
      EMAIL_TRANSPORT: 'smtp',
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '587',
      SMTP_USER: 'apikey',
      SMTP_PASS: 'smtp-password-placeholder',
      MAIL_FROM: 'MedAssist <no-reply@example.com>',
    });
    expect(res.code).toBe(0);
    expect(JSON.parse(res.stdout)).toMatchObject({
      isProd: true,
      cookie: { secure: true, sameSite: 'none' },
      email: { transport: 'smtp' },
    });
  });

  it('does not require MONGO_URI or secrets in test, and hashes cheaply', async () => {
    const res = await loadEnv({ NODE_ENV: 'test' });
    expect(res.code).toBe(0);
    expect(JSON.parse(res.stdout)).toMatchObject({ isTest: true, auth: { bcryptRounds: 4 } });
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
