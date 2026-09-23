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

describe('config/env', () => {
  it('applies defaults and exposes a frozen config', async () => {
    const res = await loadEnv({ MONGO_URI: 'mongodb://127.0.0.1:27017/x' });
    expect(res.code).toBe(0);
    expect(JSON.parse(res.stdout)).toMatchObject({
      nodeEnv: 'development',
      isDev: true,
      isProd: false,
      port: 5000,
      clientUrl: 'http://localhost:5173',
      logLevel: 'info',
    });
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
