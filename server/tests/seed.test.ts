import { AuditLog } from '../src/modules/audit/model.js';
import { User } from '../src/modules/users/model.js';
import { demoLoginTable, runSeed } from '../src/seed/index.js';
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from '../src/seed/users.js';
import { resetDb } from './helpers/auth.js';
import { api } from './helpers/testApp.js';

describe('seed', () => {
  beforeEach(resetDb);

  it('creates one login per role that can sign in with the demo password', async () => {
    const summary = await runSeed();
    expect(summary).toEqual({ users: { created: DEMO_ACCOUNTS.length, updated: 0 } });

    const roles = new Set((await User.find().lean()).map((u) => u.role));
    expect([...roles].sort()).toEqual(['admin', 'doctor', 'labtech', 'patient', 'receptionist']);

    for (const email of [
      'admin@medassist.dev',
      'dr.mehta@medassist.dev',
      'patient1@medassist.dev',
    ]) {
      const res = await api().post('/api/v1/auth/login').send({ email, password: DEMO_PASSWORD });
      expect(res.status, email).toBe(200);
      expect(res.body.data.user.mustChangePassword).toBe(false);
    }
  });

  it('is idempotent and repairs demo accounts (upsert)', async () => {
    await runSeed();
    await User.updateOne(
      { email: 'lab1@medassist.dev' },
      {
        $set: { isActive: false, mustChangePassword: true, lockUntil: new Date(Date.now() + 1e6) },
      },
    );

    const summary = await runSeed();
    expect(summary).toEqual({ users: { created: 0, updated: DEMO_ACCOUNTS.length } });
    expect(await User.countDocuments()).toBe(DEMO_ACCOUNTS.length);
    const lab = await User.findOne({ email: 'lab1@medassist.dev' }).lean();
    expect(lab).toMatchObject({ isActive: true, mustChangePassword: false });
    expect(lab?.lockUntil).toBeUndefined();
  });

  it('audits what it did as the system', async () => {
    await runSeed();
    const entries = await AuditLog.find({ 'metadata.source': 'seed' }).lean();
    expect(entries).toHaveLength(DEMO_ACCOUNTS.length);
    expect(entries.every((e) => e.actor?.user === null && e.action === 'user.create')).toBe(true);
  });

  it('only allows --reset in development', async () => {
    await expect(runSeed({ reset: true })).rejects.toThrow(
      /only allowed with NODE_ENV=development/,
    );
  });

  it('prints a table of the demo logins', () => {
    const table = demoLoginTable();
    expect(table.split('\n')[0]).toMatch(/^Role\s+Email\s+Password$/);
    for (const a of DEMO_ACCOUNTS) expect(table).toContain(a.email);
  });
});
