import { fileURLToPath } from 'node:url';
import { connectDB, disconnectDB } from '../config/db.js';
import { config } from '../config/env.js';
import { AuditLog } from '../modules/audit/model.js';
import { Session } from '../modules/sessions/model.js';
import { User } from '../modules/users/model.js';
import * as audit from '../services/audit.service.js';
import { logger, serializeError } from '../utils/logger.js';
import { DEMO_ACCOUNTS, DEMO_PASSWORD, seedUsers } from './users.js';

/**
 * `npm run seed` – demo data (spec §15.3). One function per data type; later phases add theirs
 * to SEEDERS in dependency order (settings, departments, doctors, … in Phase 2).
 */
const SEEDERS: { name: string; run: () => Promise<Record<string, number>> }[] = [
  { name: 'users', run: seedUsers },
];

/** Collections `--reset` empties. Phase 2+ add theirs. */
async function resetData() {
  await Promise.all([
    User.deleteMany({}),
    Session.deleteMany({}),
    AuditLog.collection.deleteMany({}), // raw driver: Mongoose blocks audit deletes by design
  ]);
  audit.resetAuditChainCache();
}

/** Plain-text table of the demo logins. */
export function demoLoginTable(): string {
  const rows = [
    ['Role', 'Email', 'Password'],
    ...DEMO_ACCOUNTS.map((a) => [a.role, a.email, DEMO_PASSWORD]),
  ];
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map((r) => r[i]!.length)));
  const line = (r: string[]) =>
    r
      .map((c, i) => c.padEnd(widths[i]!))
      .join('  ')
      .trimEnd();
  const rule = widths.map((w) => '-'.repeat(w)).join('  ');
  return [line(rows[0]!), rule, ...rows.slice(1).map(line)].join('\n');
}

/**
 * Runs every seeder. Refuses in production; `reset` (wipe first) is development only.
 * Assumes an open database connection.
 */
export async function runSeed({ reset = false }: { reset?: boolean } = {}) {
  if (config.isProd) throw new Error('Refusing to seed with NODE_ENV=production');
  if (reset && !config.isDev) throw new Error('--reset is only allowed with NODE_ENV=development');

  if (reset) {
    await resetData();
    logger.info('Wiped users, sessions and audit logs');
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
    logger.info({ summary }, 'Seed complete');
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
