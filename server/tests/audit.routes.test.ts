import { AuditLog } from '../src/modules/audit/model.js';
import { flushAudit } from '../src/services/audit.service.js';
import { loginAs, resetDb, TEST_PASSWORD } from './helpers/auth.js';
import { api, expectErrorShape } from './helpers/testApp.js';

describe('/audit-logs', () => {
  beforeEach(resetDb);

  it('admins see login entries, newest first, with filters', async () => {
    const admin = await loginAs('admin');
    const doctor = await loginAs('doctor');
    await api()
      .post('/api/v1/auth/login')
      .send({ email: doctor.user.email, password: 'Wrong-123x' });
    await flushAudit();

    const all = await api().get('/api/v1/audit-logs').set(admin.auth);
    expect(all.status).toBe(200);
    expect(all.body.data.map((e: { action: string }) => e.action)).toEqual([
      'auth.login_failed',
      'auth.login',
      'auth.login',
    ]);
    expect(all.body.data[1]).toMatchObject({
      actor: { user: doctor.user._id.toString(), role: 'doctor' },
      resource: { type: 'user', id: doctor.user._id.toString() },
      outcome: 'success',
      request: { method: 'POST', path: '/api/v1/auth/login' },
      hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(JSON.stringify(all.body)).not.toContain(TEST_PASSWORD);

    const byActor = await api()
      .get(`/api/v1/audit-logs?actor=${doctor.user._id}&outcome=failure`)
      .set(admin.auth);
    expect(byActor.body.data).toHaveLength(1);
    expect(byActor.body.meta).toMatchObject({ total: 1 });

    const byAction = await api().get('/api/v1/audit-logs?action=auth.login').set(admin.auth);
    expect(byAction.body.data).toHaveLength(2);

    const future = new Date(Date.now() + 3_600_000).toISOString();
    const none = await api()
      .get(`/api/v1/audit-logs?from=${encodeURIComponent(future)}`)
      .set(admin.auth);
    expect(none.body.data).toHaveLength(0);

    const bad = await api().get('/api/v1/audit-logs?from=yesterday&actor=x').set(admin.auth);
    expectErrorShape(bad.body, 'VALIDATION_ERROR');
  });

  it('GET /audit-logs/verify reports an intact chain, then the first tampered entry', async () => {
    const admin = await loginAs('admin');
    await loginAs('patient');

    const ok = await api().get('/api/v1/audit-logs/verify').set(admin.auth);
    expect(ok.body.data).toEqual({ ok: true, checked: 2 });

    await AuditLog.collection.updateOne({ seq: 2 }, { $set: { 'actor.role': 'admin' } });
    const broken = await api().get('/api/v1/audit-logs/verify').set(admin.auth);
    expect(broken.body.message).toBe('Audit chain is broken');
    const second = await AuditLog.findOne({ seq: 2 }).lean();
    expect(broken.body.data).toEqual({
      ok: false,
      checked: 2,
      firstBrokenId: second?._id.toString(),
      reason: 'hash_mismatch',
    });
  });

  it.each(['doctor', 'receptionist', 'labtech', 'patient'] as const)('403 for %s', async (role) => {
    const { auth } = await loginAs(role);
    for (const path of ['/api/v1/audit-logs', '/api/v1/audit-logs/verify']) {
      const res = await api().get(path).set(auth);
      expect(res.status).toBe(403);
      expectErrorShape(res.body, 'FORBIDDEN');
    }
  });
});
