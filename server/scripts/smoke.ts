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
  await phase4Checks(api, check, login);
  await phase5Checks(api, check, login);

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
    // Phase 5: doctors see the patients they have a care relationship with (spec §2.3).
    const mine = await call(api, '/patients?scope=mine&limit=100', { headers: doctor });
    const mineItems = (mine.body.data as unknown as Item[]) ?? [];
    check(
      'dr.mehta lists only related patients (scope=mine)',
      mine.res.status === 200 && mineItems.length > 0,
      `got ${mineItems.length}`,
    );
    if (mineItems[0]) {
      const view = await call(api, `/patients/${mineItems[0].id}`, { headers: doctor });
      check(
        'dr.mehta opens a related patient (doctor view: clinical, no insurance)',
        view.res.status === 200 &&
          JSON.stringify(view.body).includes('"chronicConditions"') &&
          !JSON.stringify(view.body).includes('"insurance"'),
        `status ${view.res.status}`,
      );
    }
    const stranger = ((list.body.data as unknown as Item[]) ?? []).find(
      (p) => !mineItems.some((m) => m.id === p.id),
    );
    if (stranger) {
      const denied = await call(api, `/patients/${stranger.id}`, { headers: doctor });
      check('dr.mehta gets 404 without a care relationship', denied.res.status === 404);
    }
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

/**
 * Phase 4: seeded appointments, a live booking race on one free slot (exactly one wins; the
 * winner is cancelled again, reason "Smoke test"), a queue.updated socket event with ids only,
 * the kiosk board (no patient data; wrong key refused) and patients limited to their own.
 */
async function phase4Checks(
  api: string,
  check: (name: string, ok: boolean, detail?: string) => void,
  login: (email: string) => ReturnType<typeof call>,
) {
  const as = async (email: string) => {
    const r = await login(email);
    const token = r.body.data?.accessToken;
    if (!token) check(`${email} logs in for Phase 4 checks`, false, `status ${r.res.status}`);
    return token ? { token, headers: { Authorization: `Bearer ${token}` } } : null;
  };
  const reception = await as('reception1@medassist.dev');
  const patient = await as('patient1@medassist.dev');
  if (!reception || !patient) return;
  const get = async (path: string, headers: Record<string, string>) => {
    const res = await fetch(`${api}${path}`, { headers });
    return { res, raw: await res.text() };
  };
  const json = <T>(raw: string) => JSON.parse(raw) as { data: T; meta?: { total: number } };

  const all = await get('/appointments?limit=1&from=2000-01-01', reception.headers);
  const total = json<unknown[]>(all.raw).meta?.total ?? 0;
  check('at least 250 seeded appointments', total >= 250, `got ${total}`);

  // A free slot of dr.mehta 10–13 days ahead (few seeded bookings there).
  const doctors = json<Item[]>((await get('/doctors?q=Mehta', reception.headers)).raw).data;
  const doctorId = doctors[0]?.id;
  const clinic = json<{ timezone: string }>((await get('/settings/public', {})).raw).data;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: clinic.timezone }).format(new Date());
  const addDays = (d: string, n: number) => {
    const t = new Date(`${d}T00:00:00Z`);
    t.setUTCDate(t.getUTCDate() + n);
    return t.toISOString().slice(0, 10);
  };
  let slot: { startAt: string } | undefined;
  let slotDate = '';
  for (let d = 13; d >= 10 && !slot && doctorId; d -= 1) {
    slotDate = addDays(today, d);
    const slots = json<{ slots: { startAt: string }[] }>(
      (await get(`/doctors/${doctorId}/slots?date=${slotDate}`, reception.headers)).raw,
    ).data.slots;
    slot = slots.at(-1);
  }
  const patients = json<Item[]>(
    (await get('/patients?limit=40&sort=mrn', reception.headers)).raw,
  ).data;
  const services = json<(Item & { code: string })[]>(
    (await get('/services?limit=100', {})).raw,
  ).data;
  const serviceId = services.find((s) => s.code === 'CONS-GEN')?.id;
  if (!slot || !doctorId || !serviceId || patients.length < 40) {
    check('a free slot for the booking race', false, `slot ${Boolean(slot)}`);
    return;
  }

  // Two receptionists book the same slot at once (patients unlikely to be busy then).
  const book = (patientId: string) =>
    call(api, '/appointments', {
      method: 'POST',
      headers: reception.headers,
      body: JSON.stringify({ patientId, doctorId, serviceId, startAt: slot.startAt }),
    });
  const race = await Promise.all([book(patients[38]!.id), book(patients[39]!.id)]);
  const statuses = race.map((r) => r.res.status).sort();
  const winner = race.find((r) => r.res.status === 201)?.body.data as Item | undefined;
  const loserCode = race.find((r) => r.res.status !== 201)?.body.error?.code;
  check(
    'two parallel bookings of one slot: exactly one wins, the other gets SLOT_UNAVAILABLE',
    statuses.join() === '201,409' && loserCode === 'SLOT_UNAVAILABLE',
    `${statuses.join()} ${loserCode ?? ''}`,
  );

  if (winner) {
    // The cancel is announced over Socket.IO to the doctor's queue room, with ids only.
    const { io } = await import('socket.io-client');
    const socket = io(api.replace(/\/api\/v1$/, ''), {
      auth: { token: reception.token },
      transports: ['websocket'],
      reconnection: false,
    });
    const event = new Promise<unknown>((resolve) => {
      socket.on('queue.updated', resolve);
      setTimeout(() => resolve(null), 5000);
    });
    const joined = await new Promise<boolean>((resolve) => {
      socket.on('connect', () =>
        socket.emit('queue:subscribe', { doctorId, date: slotDate }, (r: { ok: boolean }) =>
          resolve(r.ok),
        ),
      );
      socket.on('connect_error', () => resolve(false));
    });
    const cancel = await call(api, `/appointments/${winner.id}/cancel`, {
      method: 'POST',
      headers: reception.headers,
      body: JSON.stringify({ reason: 'Smoke test' }),
    });
    const payload = await event;
    socket.disconnect();
    check('smoke booking cancelled again', cancel.res.status === 200);
    check(
      'queue.updated arrives over Socket.IO with ids only',
      joined && JSON.stringify(payload) === JSON.stringify({ doctorId, date: slotDate }),
      JSON.stringify(payload),
    );
  }

  const queue = await get(`/queue?doctor=${doctorId}&date=${today}`, reception.headers);
  check('reception sees a doctor queue', queue.res.status === 200, `status ${queue.res.status}`);

  const key = process.env.KIOSK_KEY;
  if (key) {
    const board = await get(`/queue/board?key=${encodeURIComponent(key)}`, {});
    check(
      'queue board: public with the kiosk key, no patient data',
      board.res.status === 200 && !/firstName|lastName|mrn|patient|MRN-/i.test(board.raw),
    );
    const wrong = await get('/queue/board?key=wrong-kiosk-key-000000000000', {});
    check('queue board refuses a wrong key', wrong.res.status === 401);
  } else {
    check('KIOSK_KEY is set in server/.env', false, 'the queue board is switched off');
  }

  // patient1 cannot open someone else's appointment.
  const others = json<Item[]>(
    (
      await get(
        `/appointments?patient=${patients[20]!.id}&limit=1&from=2000-01-01`,
        reception.headers,
      )
    ).raw,
  ).data;
  if (others[0]) {
    const denied = await get(`/appointments/${others[0].id}`, patient.headers);
    check("patient1 gets 404 on someone else's appointment", denied.res.status === 404);
  }
  const mine = await get('/appointments?limit=100&from=2000-01-01', patient.headers);
  check(
    'patient1 lists only their own appointments (no patient details)',
    mine.res.status === 200 && !/"patient"/.test(mine.raw),
  );
  await Promise.all(
    [reception, patient].map((a) =>
      call(api, '/auth/logout', { method: 'POST', headers: a.headers }),
    ),
  );
}

/**
 * Phase 5: seeded clinical notes and prescriptions – doctors read their signed notes (and the
 * amendment history), today's consultation has a draft, patient1 sees only issued prescriptions
 * without allergy internals, reception prints by patient, admins get 403. Read-only.
 */
async function phase5Checks(
  api: string,
  check: (name: string, ok: boolean, detail?: string) => void,
  login: (email: string) => ReturnType<typeof call>,
) {
  const as = async (email: string) => {
    const r = await login(email);
    const token = r.body.data?.accessToken;
    if (!token) check(`${email} logs in for Phase 5 checks`, false, `status ${r.res.status}`);
    return token ? { Authorization: `Bearer ${token}` } : null;
  };
  type Item = { id: string; status?: string };
  const list = (body: { data?: unknown }) => (body.data as Item[] | undefined) ?? [];

  const doctor = await as('dr.mehta@medassist.dev');
  const patient = await as('patient1@medassist.dev');
  const reception = await as('reception1@medassist.dev');
  const admin = await as('admin@medassist.dev');
  if (!doctor || !patient || !reception || !admin) return;

  const notes = await call(api, '/encounters?limit=100', { headers: doctor });
  const signed = list(notes.body).find((e) => e.status === 'signed' || e.status === 'amended');
  check(
    'dr.mehta lists signed notes (no clinical text in the list)',
    notes.res.status === 200 &&
      Boolean(signed) &&
      !/chiefComplaint/.test(JSON.stringify(notes.body)),
  );
  if (signed) {
    const one = await call(api, `/encounters/${signed.id}`, { headers: doctor });
    check(
      'dr.mehta opens a signed note',
      one.res.status === 200 &&
        Boolean((one.body.data as { chiefComplaint?: string })?.chiefComplaint),
    );
    const history = await call(api, `/encounters/${signed.id}/amendments`, { headers: doctor });
    check('the amendment history loads', history.res.status === 200);
  }
  const underWay = await call(api, '/appointments?status=in_consultation&from=2000-01-01', {
    headers: doctor,
  });
  const current = list(underWay.body)[0];
  if (current) {
    const draft = await call(api, `/appointments/${current.id}/encounter`, { headers: doctor });
    check(
      "today's consultation has a draft note",
      draft.res.status === 200 && (draft.body.data as Item | undefined)?.status === 'draft',
      `status ${draft.res.status}`,
    );
  }

  const mine = await call(api, '/prescriptions', { headers: patient });
  const rx = list(mine.body);
  check(
    'patient1 sees only issued/completed prescriptions',
    mine.res.status === 200 && rx.every((p) => p.status === 'issued' || p.status === 'completed'),
    `status ${mine.res.status}`,
  );
  if (rx[0]) {
    const one = await call(api, `/prescriptions/${rx[0].id}`, { headers: patient });
    check(
      "patient1's prescription has no allergy internals",
      one.res.status === 200 && !/allergy|acknowledged/i.test(JSON.stringify(one.body)),
    );
  }
  const me = await call(api, '/patients/me', { headers: patient });
  const myId = (me.body.data as { id?: string } | undefined)?.id;
  if (myId) {
    const printable = await call(api, `/prescriptions?patient=${myId}`, { headers: reception });
    check('reception lists a patient’s prescriptions for printing', printable.res.status === 200);
  }
  const adminDenied = await call(api, '/encounters', { headers: admin });
  check('admins get 403 on clinical notes', adminDenied.res.status === 403);
  const noScope = await call(api, '/prescriptions', { headers: reception });
  check('reception must choose a patient to list prescriptions', noScope.res.status === 400);

  await Promise.all(
    [doctor, patient, reception, admin].map((h) =>
      call(api, '/auth/logout', { method: 'POST', headers: h }),
    ),
  );
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
