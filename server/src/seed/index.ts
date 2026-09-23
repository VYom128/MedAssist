import { connectDB, disconnectDB } from '../config/db.js';
import { AUDIT_ACTIONS, ROLES, type Role } from '../config/constants.js';
import { config } from '../config/env.js';
import { AuditLog } from '../modules/audit/model.js';
import { Session } from '../modules/sessions/model.js';
import { User } from '../modules/users/model.js';
import * as audit from '../services/audit.service.js';
import { logger, serializeError } from '../utils/logger.js';
import { hashPassword } from '../utils/password.js';

/**
 * `npm run seed` – demo accounts (spec §15.3). Phase 1 seeds one login per role; later phases
 * add clinic data. Existing accounts are left untouched. `--reset` wipes users, sessions and
 * audit logs first and refuses to run in production.
 */

export const DEMO_PASSWORD = 'Password@123';

const DEMO_ACCOUNTS: { email: string; firstName: string; lastName: string; role: Role }[] = [
  { email: 'admin@medassist.dev', firstName: 'Asha', lastName: 'Rao', role: ROLES.ADMIN },
  {
    email: 'reception1@medassist.dev',
    firstName: 'Ravi',
    lastName: 'Kumar',
    role: ROLES.RECEPTIONIST,
  },
  { email: 'lab1@medassist.dev', firstName: 'Lakshmi', lastName: 'Nair', role: ROLES.LABTECH },
  { email: 'dr.mehta@medassist.dev', firstName: 'Anil', lastName: 'Mehta', role: ROLES.DOCTOR },
  { email: 'dr.iyer@medassist.dev', firstName: 'Kavya', lastName: 'Iyer', role: ROLES.DOCTOR },
  // Patient records and linking arrive in Phase 3; these are portal logins only for now.
  { email: 'patient1@medassist.dev', firstName: 'Priya', lastName: 'Sharma', role: ROLES.PATIENT },
  { email: 'patient2@medassist.dev', firstName: 'Rahul', lastName: 'Verma', role: ROLES.PATIENT },
];

async function reset() {
  if (config.isProd) throw new Error('Refusing to run --reset with NODE_ENV=production');
  await Promise.all([
    User.deleteMany({}),
    Session.deleteMany({}),
    AuditLog.collection.deleteMany({}), // raw driver: Mongoose blocks audit deletes by design
  ]);
  audit.resetAuditChainCache();
  logger.info('Wiped users, sessions and audit logs');
}

async function seedUsers() {
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  let created = 0;
  for (const account of DEMO_ACCOUNTS) {
    if (await User.exists({ email: account.email })) continue;
    const user = await User.create({ ...account, passwordHash, emailVerifiedAt: new Date() });
    await audit.record({
      action: AUDIT_ACTIONS.USER_CREATE,
      actor: null, // system
      resource: { type: 'user', id: user._id },
      metadata: { role: user.role, source: 'seed' },
    });
    created += 1;
  }
  return created;
}

async function main() {
  const wantsReset = process.argv.includes('--reset');
  await connectDB();
  try {
    if (wantsReset) await reset();
    const created = await seedUsers();
    await audit.flushAudit();
    logger.info(
      {
        created,
        skipped: DEMO_ACCOUNTS.length - created,
        demoPassword: DEMO_PASSWORD, // demo-only shared password, printed on purpose (spec §15.3)
        accounts: DEMO_ACCOUNTS.map((a) => `${a.role.padEnd(12)} ${a.email}`),
      },
      'Seed complete – demo accounts',
    );
  } finally {
    await disconnectDB();
  }
}

main().catch((err) => {
  logger.fatal({ err: serializeError(err) }, 'Seed failed');
  process.exit(1);
});
