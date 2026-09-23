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
import { demoLogins } from '../src/seed/index.js';

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

type Item = Record<string, unknown> & { id: string };

/** Keys that must never appear in a public (no token) response. */
const PRIVATE_KEYS =
  /"(email|phone|registrationNumber|roomNumber|gstin|isActive|lockVersion|passwordHash)"/;

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

  await phase2Checks(api, check, login);
  await phase3Checks(api, check, login);

  for (const [name, ok, detail] of results) {
    out(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? ` (${detail})` : ''}`);
  }
  const passed = results.every(([, ok]) => ok);
  if (!passed && admin.res.status === 401)
    out('Hint: run `npm run seed` to create the demo accounts.');
  return passed;
}

/** Phase 2: the seeded clinic set-up, public field exposure and every demo login. */
async function phase2Checks(
  api: string,
  check: (name: string, ok: boolean, detail?: string) => void,
  login: (email: string) => ReturnType<typeof call>,
) {
  const list = async (path: string, headers: Record<string, string> = {}) => {
    const r = await call(api, path, { headers });
    return {
      status: r.res.status,
      items: (r.body.data as unknown as Item[]) ?? [],
      raw: JSON.stringify(r.body),
    };
  };

  // Public endpoints: data present, nothing private.
  const settings = await call(api, '/settings/public');
  const publicRaw = JSON.stringify(settings.body);
  check(
    'public settings exist (clinic timezone set)',
    settings.res.status === 200 && Boolean(settings.body.data?.timezone),
    publicRaw.slice(0, 120),
  );
  check(
    'public settings hide admin fields',
    !/gstin|invoicePrefix|registrationNumber/.test(publicRaw),
  );

  const departments = await list('/departments?limit=100');
  check('5 departments', departments.items.length === 5, `got ${departments.items.length}`);
  const services = await list('/services?limit=100');
  check(
    'about 12 services',
    services.items.length >= 10 && services.items.length <= 15,
    `got ${services.items.length}`,
  );
  check(
    'service prices are integer paise',
    services.items.every((x) => Number.isInteger(x.pricePaise)),
  );
  const doctors = await list('/doctors?limit=100');
  check('8 doctors with profiles', doctors.items.length === 8, `got ${doctors.items.length}`);
  for (const [name, r] of [
    ['departments', departments],
    ['services', services],
    ['doctors', doctors],
  ] as const) {
    check(`public ${name} expose no private fields`, !PRIVATE_KEYS.test(r.raw));
  }
  if (doctors.items[0]) {
    const one = await call(api, `/doctors/${doctors.items[0].id}`);
    check(
      'public doctor detail exposes no private fields',
      !PRIVATE_KEYS.test(JSON.stringify(one.body)),
    );
  }

  // Staff views: schedules, leave, lab tests.
  const admin = await login('admin@medassist.dev');
  const token = admin.body.data?.accessToken;
  if (!token) {
    check('admin logs in for Phase 2 checks', false, `status ${admin.res.status}`);
    return;
  }
  const auth = { Authorization: `Bearer ${token}` };
  let withSchedule = 0;
  let withLeave = 0;
  for (const d of doctors.items) {
    const sched = await call(api, `/doctors/${d.id}/schedule`, { headers: auth });
    const current = sched.body.data?.current as { days?: { sessions: unknown[] }[] } | null;
    if (current?.days?.some((day) => day.sessions.length > 0)) withSchedule += 1;
    const leaves = await list(`/doctors/${d.id}/leaves`, auth);
    if (leaves.items.length > 0) withLeave += 1;
  }
  check(
    'every doctor has a weekly schedule',
    withSchedule === doctors.items.length,
    `${withSchedule}/${doctors.items.length}`,
  );
  check('2 doctors have upcoming leave', withLeave === 2, `got ${withLeave}`);
  const labTests = await list('/lab-tests?limit=100', auth);
  check(
    'about 15 lab tests',
    labTests.items.length >= 13 && labTests.items.length <= 17,
    `got ${labTests.items.length}`,
  );
  check(
    'lab tests have parameters',
    labTests.items.every((t) => Array.isArray(t.parameters) && t.parameters.length > 0),
  );
  await call(api, '/auth/logout', { method: 'POST', headers: auth });

  // Every demo account (spec §15.3 + seeded doctors) logs in without a forced password change.
  const failed: string[] = [];
  for (const { email } of demoLogins()) {
    const r = await login(email);
    const t = r.body.data?.accessToken;
    const user = r.body.data?.user as { mustChangePassword?: boolean } | undefined;
    if (r.res.status !== 200 || user?.mustChangePassword) failed.push(`${email} (${r.res.status})`);
    if (t)
      await call(api, '/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${t}` },
      });
  }
  check(`all ${demoLogins().length} demo accounts log in`, failed.length === 0, failed.join(', '));
}

/** Phase 3: seeded patients, role views, own-record access and the pending sign-up. */
async function phase3Checks(
  api: string,
  check: (name: string, ok: boolean, detail?: string) => void,
  login: (email: string) => ReturnType<typeof call>,
) {
  const as = async (email: string) => {
    const r = await login(email);
    const token = r.body.data?.accessToken;
    if (!token) check(`${email} logs in for Phase 3 checks`, false, `status ${r.res.status}`);
    return token ? { Authorization: `Bearer ${token}` } : null;
  };
  const logout = (headers: Record<string, string>) =>
    call(api, '/auth/logout', { method: 'POST', headers });

  const patient = await as('patient1@medassist.dev');
  const reception = await as('reception1@medassist.dev');
  const admin = await as('admin@medassist.dev');
  if (!patient || !reception || !admin) return;

  const me = await call(api, '/patients/me', { headers: patient });
  const myId = (me.body.data as Item | undefined)?.id;
  check('patient1 sees their own record', me.res.status === 200 && Boolean(myId));

  const list = await call(api, '/patients?limit=100', { headers: reception });
  const total = (list.body as { meta?: { total?: number } }).meta?.total ?? 0;
  check('at least 60 active patients', total >= 60, `got ${total}`);
  const other = ((list.body.data as unknown as Item[]) ?? []).find((p) => p.id !== myId);
  if (other) {
    const denied = await call(api, `/patients/${other.id}`, { headers: patient });
    check("patient1 gets 404 on someone else's record", denied.res.status === 404);
  }
  if (myId) {
    const phone = (me.body.data as { phone?: string }).phone ?? '';
    const found = await call(api, `/patients?q=${encodeURIComponent(phone.slice(3))}`, {
      headers: reception,
    });
    check(
      'reception finds a patient by phone (national format)',
      ((found.body.data as unknown as Item[]) ?? []).some((p) => p.id === myId),
    );
    const receptionView = JSON.stringify(
      (await call(api, `/patients/${myId}`, { headers: reception })).body,
    );
    const adminView = JSON.stringify(
      (await call(api, `/patients/${myId}`, { headers: admin })).body,
    );
    check(
      'reception view has allergies but no chronic conditions',
      receptionView.includes('"allergies"') && !receptionView.includes('"chronicConditions"'),
    );
    check(
      'admin view has neither allergies nor chronic conditions',
      !/"allergies"|"chronicConditions"/.test(adminView),
    );
  }

  const pendingLinks = await call(api, '/patients/pending-links', { headers: reception });
  const pendingTotal = (pendingLinks.body as { meta?: { total?: number } }).meta?.total ?? 0;
  check('a pending self-sign-up waits for reception', pendingTotal >= 1, `got ${pendingTotal}`);
  const pending = await as('pending1@medassist.dev');
  if (pending) {
    const blocked = await call(api, '/patients/me', { headers: pending });
    check(
      'pending sign-up is blocked from records',
      blocked.res.status === 403 && blocked.body.error?.code === 'PATIENT_LINK_PENDING',
      `status ${blocked.res.status}`,
    );
    await logout(pending);
  }

  const doctor = await as('dr.mehta@medassist.dev');
  if (doctor) {
    const none = await call(api, '/patients', { headers: doctor });
    check(
      'doctors see no patients until care relationships (Phase 5)',
      none.res.status === 200 && ((none.body.data as unknown as Item[]) ?? []).length === 0,
    );
    await logout(doctor);
  }
  const lab = await as('lab1@medassist.dev');
  if (lab) {
    const denied = await call(api, '/patients', { headers: lab });
    check('lab technicians get 403 on /patients', denied.res.status === 403);
    await logout(lab);
  }
  await Promise.all([logout(patient), logout(reception), logout(admin)]);
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
