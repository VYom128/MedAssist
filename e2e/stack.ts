import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

/**
 * A throwaway stack for the E2E test (spec §15.2): an in-memory MongoDB replica set, a fresh
 * `seed --reset`, the API (mock AI, no jobs, random secrets, server/.env ignored) and a production
 * build of the client served by `vite preview`, each on a free port. Nothing touches the developer's
 * database or running servers.
 */

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const STACK_DIR = path.join(ROOT, 'e2e', '.stack');
export const STACK_FILE = path.join(STACK_DIR, 'stack.json');
const bin = (name: string) => path.join(ROOT, 'node_modules', '.bin', name);

export interface StackInfo {
  baseURL: string;
  apiURL: string;
  timezone: string;
  doctor: { email: string; name: string };
  patient: { email: string; name: string };
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

async function waitFor(url: string, label: string, timeoutMs = 90_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${label} did not start within ${timeoutMs / 1000} s (${url})`);
}

/**
 * Runs a command to completion without blocking the event loop: mongodb-memory-server reads
 * mongod's output in this process, and a blocked loop (spawnSync) would stall mongod itself.
 */
function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, label: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const keep = (d: Buffer) => {
      output = (output + d.toString()).slice(-4000);
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${label} failed (exit ${code}):\n${output}`)),
    );
  });
}

/** A zone where it is daytime now, so today still has bookable slots whenever the test runs. */
function daytimeZone(): string {
  const zones = [
    'Asia/Kolkata',
    'Europe/London',
    'America/New_York',
    'America/Los_Angeles',
    'Pacific/Honolulu',
    'Asia/Tokyo',
    'Pacific/Auckland',
    'Atlantic/Azores',
  ];
  const hour = (tz: string) =>
    Number(
      new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: tz }).format(
        new Date(),
      ),
    );
  return zones.find((tz) => hour(tz) >= 8 && hour(tz) < 18) ?? 'Asia/Kolkata';
}

const clinicDate = (tz: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

async function api<T>(
  apiURL: string,
  method: string,
  url: string,
  token?: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${apiURL}${url}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json()) as { data: T; message?: string };
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status} ${json.message ?? ''}`);
  return json.data;
}

/** Starts the stack; returns the teardown. */
export async function startStack(): Promise<() => Promise<void>> {
  mkdirSync(STACK_DIR, { recursive: true });
  const children: ChildProcess[] = [];
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  const teardown = async () => {
    for (const c of children) c.kill('SIGTERM');
    await replSet.stop();
  };
  try {
    const [apiPort, webPort] = [await freePort(), await freePort()];
    const apiURL = `http://localhost:${apiPort}/api/v1`;
    const baseURL = `http://localhost:${webPort}`;
    const serverEnv: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NODE_ENV: 'development',
      DOTENV_CONFIG_PATH: '/nonexistent/.env', // never the developer's server/.env
      MONGO_URI: replSet.getUri('medassist_e2e'),
      PORT: String(apiPort),
      CLIENT_URL: baseURL,
      JWT_ACCESS_SECRET: randomBytes(32).toString('hex'),
      AUDIT_HASH_SECRET: randomBytes(32).toString('hex'),
      AI_PROVIDER: 'mock',
      JOBS_ENABLED: 'false',
      EMAIL_TRANSPORT: 'console',
      UPLOAD_DIR: mkdtempSync(path.join(tmpdir(), 'medassist-e2e-uploads-')),
      RATE_LIMIT_MAX: '100000',
      LOG_LEVEL: 'warn',
    };

    const serverDir = path.join(ROOT, 'server');
    await run(bin('tsx'), ['src/seed/index.ts', '--reset'], serverDir, serverEnv, 'Seed');

    const apiProc = spawn(bin('tsx'), ['src/server.ts'], {
      cwd: serverDir,
      env: serverEnv,
      stdio: 'inherit',
    });
    children.push(apiProc);

    const clientDir = path.join(ROOT, 'client');
    const outDir = path.join(STACK_DIR, 'client-dist');
    const clientEnv = {
      ...process.env,
      VITE_API_URL: apiURL,
      VITE_SOCKET_URL: `http://localhost:${apiPort}`,
    };
    await run(
      bin('vite'),
      ['build', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'warn'],
      clientDir,
      clientEnv,
      'Client build',
    );
    const webProc = spawn(
      bin('vite'),
      ['preview', '--outDir', outDir, '--port', String(webPort), '--strictPort'],
      { cwd: clientDir, env: clientEnv, stdio: 'ignore' },
    );
    children.push(webProc);

    await waitFor(`${apiURL}/health`, 'API');
    await waitFor(baseURL, 'Client');

    // Test preparation through the API as the demo admin: a daytime clinic zone open every day,
    // and an all-day weekly schedule for one demo doctor who has nobody in today's queue.
    const login = await api<{ accessToken: string }>(apiURL, 'POST', '/auth/login', undefined, {
      email: 'admin@medassist.dev',
      password: 'Password@123',
    });
    const admin = login.accessToken;
    const timezone = daytimeZone();
    await api(apiURL, 'PATCH', '/settings', admin, {
      timezone,
      workingDays: [0, 1, 2, 3, 4, 5, 6],
    });

    const today = clinicDate(timezone);
    const db = (await import('mongoose')).default;
    const conn = await db.createConnection(serverEnv.MONGO_URI!).asPromise();
    try {
      const doctors = await conn
        .collection('users')
        .find({ role: 'doctor', isActive: true })
        .sort({ email: 1 })
        .toArray();
      const busy = new Set(
        (
          await conn
            .collection('appointments')
            .distinct('doctor', { status: { $in: ['checked_in', 'in_consultation'] } })
        ).map(String),
      );
      // Any seeded doctor (all use the demo password) with nobody checked in or being seen.
      const doctor = doctors.find((d) => !busy.has(String(d._id)));
      if (!doctor) throw new Error('No demo doctor without a live queue');
      await api(apiURL, 'PUT', `/doctors/${String(doctor._id)}/schedule`, admin, {
        effectiveFrom: today,
        days: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          sessions: [{ start: '00:00', end: '23:55' }],
        })),
      });
      const patientUser = await conn
        .collection('users')
        .findOne({ email: 'patient1@medassist.dev' });
      const patient = await conn.collection('patients').findOne({ _id: patientUser!.patient });

      const info: StackInfo = {
        baseURL,
        apiURL,
        timezone,
        doctor: { email: String(doctor.email), name: `${doctor.firstName} ${doctor.lastName}` },
        patient: {
          email: 'patient1@medassist.dev',
          name: `${patient!.firstName} ${patient!.lastName}`,
        },
      };
      writeFileSync(STACK_FILE, JSON.stringify(info, null, 2));
    } finally {
      await conn.close();
    }
    return teardown;
  } catch (err) {
    await teardown();
    throw err;
  }
}
