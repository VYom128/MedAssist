/**
 * `npm run smoke` – checks a real API against the seeded database (run `npm run seed` first).
 *
 * Safe with a dev server running: if an API already answers on PORT (from server/.env) it is
 * used and left alone. Otherwise the script starts its own API on a free port and, when done,
 * stops only that process. It never stops or kills anything it did not start.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

loadDotenv({ quiet: true });

const SERVER_DIR = fileURLToPath(new URL('..', import.meta.url));
const DEV_PORT = Number(process.env.PORT ?? 5000);
const DEMO_PASSWORD = 'Password@123'; // server/src/seed/users.ts
const out = (line: string) => process.stdout.write(`${line}\n`);

const apiAt = (port: number) => `http://localhost:${port}/api/v1`;

async function isUp(api: string): Promise<boolean> {
  try {
    const res = await fetch(`${api}/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

/** A port nobody is listening on, chosen by the OS. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer().listen(0, () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
    probe.on('error', reject);
  });
}

/** Starts `src/server.ts` on `port` as one node process (so killing it stops the server). */
async function startOwnServer(port: number): Promise<ChildProcess> {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    cwd: SERVER_DIR,
    env: { ...process.env, PORT: String(port), LOG_LEVEL: 'warn' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr?.on('data', (d: Buffer) => (stderr += d.toString()));

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Own API exited early:\n${stderr}`);
    if (await isUp(apiAt(port))) return child;
    await new Promise((r) => setTimeout(r, 300));
  }
  child.kill('SIGTERM');
  throw new Error(`Own API did not start on port ${port}:\n${stderr}`);
}

function stopOwnServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const force = setTimeout(() => child.kill('SIGKILL'), 10_000);
    child.once('exit', () => {
      clearTimeout(force);
      resolve();
    });
    child.kill('SIGTERM'); // graceful: the API flushes audit writes and closes the DB
  });
}

// ---- Checks ----------------------------------------------------------------------------------

interface Json {
  data?: Record<string, unknown> & { accessToken?: string; ok?: boolean };
  error?: { code?: string };
}

async function call(api: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`${api}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
  return { res, body: (await res.json().catch(() => ({}))) as Json };
}

async function runChecks(api: string): Promise<boolean> {
  const results: [string, boolean, string?][] = [];
  const check = (name: string, ok: boolean, detail?: string) => results.push([name, ok, detail]);

  const login = (email: string) =>
    call(api, '/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password: DEMO_PASSWORD }),
    });

  const admin = await login('admin@medassist.dev');
  const token = admin.body.data?.accessToken;
  const cookie = admin.res.headers
    .getSetCookie()
    .find((c) => c.startsWith('ma_rt='))
    ?.split(';')[0];
  check('admin logs in', admin.res.status === 200 && Boolean(token), `status ${admin.res.status}`);
  check(
    'refresh cookie is httpOnly',
    Boolean(cookie) && /HttpOnly/i.test(admin.res.headers.getSetCookie().join()),
  );

  if (token && cookie) {
    const auth = { Authorization: `Bearer ${token}` };
    const refresh = await call(api, '/auth/refresh', {
      method: 'POST',
      headers: { Cookie: cookie, 'X-Requested-With': 'medassist' },
    });
    check(
      'refresh rotates the session',
      refresh.res.status === 200,
      `status ${refresh.res.status}`,
    );

    const users = await call(api, '/users?limit=1', { headers: auth });
    check('admin can list users', users.res.status === 200, `status ${users.res.status}`);

    const verify = await call(api, '/audit-logs/verify', { headers: auth });
    check('audit chain verifies', verify.body.data?.ok === true, JSON.stringify(verify.body.data));

    await call(api, '/auth/logout', { method: 'POST', headers: auth });
  }

  const doctor = await login('dr.mehta@medassist.dev');
  const doctorToken = doctor.body.data?.accessToken;
  if (doctorToken) {
    const denied = await call(api, '/users', {
      headers: { Authorization: `Bearer ${doctorToken}` },
    });
    check('doctor gets 403 on /users', denied.res.status === 403, `status ${denied.res.status}`);
    await call(api, '/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${doctorToken}` },
    });
  } else {
    check('doctor logs in', false, `status ${doctor.res.status}`);
  }

  for (const [name, ok, detail] of results) {
    out(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? ` (${detail})` : ''}`);
  }
  const passed = results.every(([, ok]) => ok);
  if (!passed && admin.res.status === 401)
    out('Hint: run `npm run seed` to create the demo accounts.');
  return passed;
}

async function main() {
  let own: ChildProcess | null = null;
  let api = apiAt(DEV_PORT);

  if (await isUp(api)) {
    out(`Using the API already running on port ${DEV_PORT} (it will be left running).`);
  } else {
    const port = await freePort();
    out(`No API on port ${DEV_PORT}; starting a temporary one on port ${port}.`);
    own = await startOwnServer(port);
    api = apiAt(port);
  }

  try {
    const passed = await runChecks(api);
    process.exitCode = passed ? 0 : 1;
  } finally {
    if (own) {
      await stopOwnServer(own);
      out('Stopped the temporary API.');
    }
  }
}

main().catch((err: unknown) => {
  out(`Smoke test failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
