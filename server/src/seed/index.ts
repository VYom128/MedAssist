import { fileURLToPath } from 'node:url';
import { connectDB, disconnectDB } from '../config/db.js';
import { config } from '../config/env.js';
import { AuditLog } from '../modules/audit/model.js';
import { Counter } from '../modules/counters/model.js';
import { Department } from '../modules/departments/model.js';
import { DoctorProfile } from '../modules/doctors/model.js';
import { LabTest } from '../modules/labTests/model.js';
import { DoctorLeave } from '../modules/leaves/model.js';
import { Patient } from '../modules/patients/model.js';
import { DoctorSchedule } from '../modules/schedules/model.js';
import { Service } from '../modules/services/model.js';
import { Session } from '../modules/sessions/model.js';
import { ClinicSettings } from '../modules/settings/model.js';
import { clearSettingsCache } from '../modules/settings/service.js';
import { User } from '../modules/users/model.js';
import * as audit from '../services/audit.service.js';
import { logger, serializeError } from '../utils/logger.js';
import { seedDepartments } from './departments.js';
import { doctorLogins, seedDoctors } from './doctors.js';
import { seedLabTests } from './labTests.js';
import { patientLogins, seedPatients } from './patients.js';
import { seedServices } from './services.js';
import { seedSettings } from './settings.js';
import { DEMO_ACCOUNTS, DEMO_PASSWORD, seedUsers } from './users.js';

/**
 * `npm run seed` – demo data (spec §15.3). One function per data type, in dependency order;
 * later phases add theirs (patients in Phase 3, appointments in Phase 4, …). Every seeder is an
 * upsert, so running the seed again changes nothing.
 */
const SEEDERS: { name: string; run: () => Promise<Record<string, number>> }[] = [
  { name: 'users', run: seedUsers },
  { name: 'settings', run: seedSettings },
  { name: 'departments', run: seedDepartments },
  { name: 'services', run: seedServices },
  { name: 'doctors', run: seedDoctors },
  { name: 'labTests', run: seedLabTests },
  { name: 'patients', run: seedPatients },
];

/** Collections `--reset` empties (raw driver for audit logs: Mongoose blocks those deletes). */
async function resetData() {
  await Promise.all([
    User.deleteMany({}),
    Session.deleteMany({}),
    AuditLog.collection.deleteMany({}),
    ClinicSettings.deleteMany({}),
    Department.deleteMany({}),
    Service.deleteMany({}),
    DoctorProfile.deleteMany({}),
    DoctorSchedule.deleteMany({}),
    DoctorLeave.deleteMany({}),
    LabTest.deleteMany({}),
    Patient.deleteMany({}),
    Counter.deleteMany({}),
  ]);
  clearSettingsCache();
}

/**
 * Every seeded login: staff first, then doctors, then patients (the last one, pending1, is a
 * self-sign-up waiting for reception to confirm it).
 */
export function demoLogins() {
  return [...DEMO_ACCOUNTS, ...doctorLogins(), ...patientLogins()];
}

function table(rows: string[][]): string {
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map((r) => r[i]!.length)));
  const line = (r: string[]) =>
    r
      .map((c, i) => c.padEnd(widths[i]!))
      .join('  ')
      .trimEnd();
  const rule = widths.map((w) => '-'.repeat(w)).join('  ');
  return [line(rows[0]!), rule, ...rows.slice(1).map(line)].join('\n');
}

/** Plain-text table of the demo logins. */
export function demoLoginTable(): string {
  return table([
    ['Role', 'Email', 'Password'],
    ...demoLogins().map((a) => [a.role, a.email, DEMO_PASSWORD]),
  ]);
}

/** Plain-text table of what each seeder did. */
export function summaryTable(summary: Record<string, Record<string, number>>): string {
  return table([
    ['Data', 'Result'],
    ...Object.entries(summary).map(([name, c]) => [
      name,
      Object.entries(c)
        .map(([k, v]) => `${v} ${k}`)
        .join(', '),
    ]),
  ]);
}

/**
 * Runs every seeder. Refuses in production; `reset` (wipe first) is development only.
 * Assumes an open database connection (a replica set: doctors are created in transactions).
 */
export async function runSeed({ reset = false }: { reset?: boolean } = {}) {
  if (config.isProd) throw new Error('Refusing to seed with NODE_ENV=production');
  if (reset && !config.isDev) throw new Error('--reset is only allowed with NODE_ENV=development');

  if (reset) {
    await resetData();
    logger.info('Wiped users, sessions, audit logs, clinic setup data, patients and counters');
  }
  const summary: Record<string, Record<string, number>> = {};
  for (const seeder of SEEDERS) summary[seeder.name] = await seeder.run();
  await audit.flushAudit();
  return summary;
}

async function main() {
  await connectDB();
  try {
    const summary = await runSeed({ reset: process.argv.includes('--reset') });
    logger.info(`Seed complete:\n${summaryTable(summary)}`);
    // Demo-only shared password, shown on purpose (spec §15.3).
    logger.info(`Demo logins:\n${demoLoginTable()}`);
  } finally {
    await disconnectDB();
  }
}

// Run only when executed directly (`npm run seed`), not when imported by tests.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    logger.fatal({ err: serializeError(err) }, 'Seed failed');
    process.exit(1);
  });
}
