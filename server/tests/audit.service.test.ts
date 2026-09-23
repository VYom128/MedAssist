import express from 'express';
import mongoose, { Types } from 'mongoose';
import request from 'supertest';
import { AUDIT_ACTIONS, AUDIT_GENESIS_HASH } from '../src/config/constants.js';
import { AuditLog } from '../src/modules/audit/model.js';
import * as audit from '../src/services/audit.service.js';
import { logger } from '../src/utils/logger.js';

const { diffChanges, verifyChain } = audit;

async function wipe() {
  await audit.flushAudit();
  await AuditLog.collection.deleteMany({}); // raw driver call: bypasses the append-only hooks
  audit.resetAuditChainCache();
}

/** The raw collection bypasses Mongoose hooks – how an attacker with DB access would tamper. */
const rawAuditLogs = () => mongoose.connection.collection('audit_logs');

const actor = { user: new Types.ObjectId().toString(), role: 'admin', name: 'Asha Admin' };

describe('audit.record', () => {
  beforeEach(wipe);

  it('writes linked entries: each prevHash equals the previous hash', async () => {
    const first = await audit.record({ action: AUDIT_ACTIONS.AUTH_LOGIN, actor });
    const second = await audit.record({
      action: AUDIT_ACTIONS.USER_UPDATE,
      actor,
      resource: { type: 'user', id: new Types.ObjectId() },
      changes: { fields: ['firstName'], before: { firstName: 'A' }, after: { firstName: 'B' } },
      metadata: { at: new Date(), nested: { z: 1, a: [1, 2] } },
    });
    const third = await audit.record({ action: AUDIT_ACTIONS.AUTH_LOGOUT });

    expect(first?.prevHash).toBe(AUDIT_GENESIS_HASH);
    expect(second?.prevHash).toBe(first?.hash);
    expect(third?.prevHash).toBe(second?.hash);
    expect(third?.actor).toEqual({ user: null, role: null, name: null }); // system
    expect([first?.seq, second?.seq, third?.seq]).toEqual([1, 2, 3]);

    await expect(verifyChain()).resolves.toEqual({ ok: true, checked: 3 });
  });

  it('keeps the chain linear when 20 writes are fired at once', async () => {
    await Promise.all(
      Array.from({ length: 20 }, () => audit.record({ action: AUDIT_ACTIONS.AUTH_LOGIN, actor })),
    );
    expect(await verifyChain()).toEqual({ ok: true, checked: 20 });
    const hashes = (await AuditLog.find().lean()).map((e) => e.prevHash);
    expect(new Set(hashes).size).toBe(20); // no two entries share a prevHash
  });

  it('takes the actor and request info from req', async () => {
    const app = express();
    app.use((req, _res, next) => {
      req.id = 'req-12345678';
      req.user = {
        id: actor.user,
        role: 'doctor',
        sid: 's',
        sessionFamily: 'f',
        firstName: 'Anil',
        lastName: 'Mehta',
        patientId: null,
      };
      next();
    });
    app.get('/api/v1/things/:id', async (req, res) => {
      res.json(await audit.record({ action: AUDIT_ACTIONS.ACCESS_DENIED, req }));
    });

    const res = await request(app)
      .get('/api/v1/things/42?q=Priya%20Sharma')
      .set('User-Agent', 'test-agent');
    expect(res.body).toMatchObject({
      actor: { user: actor.user, role: 'doctor', name: 'Anil Mehta' },
      request: {
        id: 'req-12345678',
        method: 'GET',
        path: '/api/v1/things/42', // no query string (could hold patient names)
        userAgent: 'test-agent',
        ip: expect.any(String),
      },
    });
  });

  it('redacts password/token/secret/hash keys in changes and metadata, at any depth', async () => {
    const entry = await audit.record({
      action: AUDIT_ACTIONS.USER_UPDATE,
      actor,
      changes: {
        fields: ['passwordHash', 'profile'],
        before: { passwordHash: 'old', profile: { apiToken: 't1', name: 'A' } },
        after: { PASSWORD: 'new', profile: { nested: [{ clientSecret: 's' }], name: 'B' } },
      },
      metadata: { resetToken: 'abc', reason: 'x' },
    });
    expect(entry?.changes).toEqual({
      fields: ['passwordHash', 'profile'],
      before: { passwordHash: '[REDACTED]', profile: { apiToken: '[REDACTED]', name: 'A' } },
      after: {
        PASSWORD: '[REDACTED]',
        profile: { nested: [{ clientSecret: '[REDACTED]' }], name: 'B' },
      },
    });
    expect(entry?.metadata).toEqual({ resetToken: '[REDACTED]', reason: 'x' });
    const stored = JSON.stringify(await AuditLog.find().lean());
    for (const secret of ['old', 'new', 't1', '"s"', 'abc']) expect(stored).not.toContain(secret);
  });

  it('never throws when a write fails: logs at error level, returns null, and recovers', async () => {
    const errorSpy = vi.spyOn(logger, 'error');
    const saveSpy = vi
      .spyOn(AuditLog.prototype, 'save')
      .mockRejectedValueOnce(new Error('disk full'));

    await expect(audit.record({ action: AUDIT_ACTIONS.AUTH_LOGIN, actor })).resolves.toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ action: AUDIT_ACTIONS.AUTH_LOGIN }),
      'Audit log write failed',
    );
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(actor.name);

    saveSpy.mockRestore();
    await audit.record({ action: AUDIT_ACTIONS.AUTH_LOGIN, actor });
    expect(await verifyChain()).toEqual({ ok: true, checked: 1 });
    errorSpy.mockRestore();
  });

  it('debounces reads of the same record by the same user within 5 minutes', async () => {
    const resource = { type: 'user', id: new Types.ObjectId() };
    const read = { action: AUDIT_ACTIONS.USER_UPDATE, actor, resource };
    expect(await audit.recordRead(read)).not.toBeNull();
    expect(await audit.recordRead(read)).toBeNull();
    await audit.recordRead({ ...read, resource: { type: 'user', id: new Types.ObjectId() } });
    expect(await AuditLog.countDocuments()).toBe(2);

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 6 * 60_000);
    await audit.recordRead(read);
    vi.useRealTimers();
    expect(await AuditLog.countDocuments()).toBe(3);
  });
});

describe('append-only AuditLog', () => {
  beforeEach(wipe);

  it('blocks updates, deletes, non-new saves and bulk writes', async () => {
    await audit.record({ action: AUDIT_ACTIONS.AUTH_LOGIN, actor });
    const doc = await AuditLog.findOne();
    if (!doc) throw new Error('missing entry');

    const attempts: [string, () => Promise<unknown>][] = [
      ['updateOne', () => AuditLog.updateOne({}, { action: 'x' })],
      ['updateMany', () => AuditLog.updateMany({}, { action: 'x' })],
      ['findOneAndUpdate', () => AuditLog.findOneAndUpdate({}, { action: 'x' })],
      ['replaceOne', () => AuditLog.replaceOne({}, { action: 'x' })],
      ['deleteOne', () => AuditLog.deleteOne({})],
      ['deleteMany', () => AuditLog.deleteMany({})],
      ['findOneAndDelete', () => AuditLog.findOneAndDelete({})],
      ['doc.deleteOne', () => doc.deleteOne()],
      ['insertMany', () => AuditLog.insertMany([{}])],
      ['bulkWrite', () => AuditLog.bulkWrite([{ deleteOne: { filter: {} } }])],
    ];
    for (const [label, attempt] of attempts) {
      await expect(attempt(), label).rejects.toMatchObject({
        statusCode: 409,
        code: 'RECORD_LOCKED',
      });
    }
    doc.action = 'tampered';
    await expect(doc.save()).rejects.toMatchObject({ code: 'RECORD_LOCKED' });

    expect(await AuditLog.countDocuments()).toBe(1);
    expect((await AuditLog.findOne().lean())?.action).toBe(AUDIT_ACTIONS.AUTH_LOGIN);
  });
});

describe('verifyChain', () => {
  beforeEach(wipe);

  const seed = async (n: number) => {
    const entries = [];
    for (let i = 0; i < n; i++)
      entries.push(await audit.record({ action: AUDIT_ACTIONS.AUTH_LOGIN, actor }));
    return entries.map((e) => String(e?._id));
  };

  it('is ok on an empty and on a clean chain', async () => {
    expect(await verifyChain()).toEqual({ ok: true, checked: 0 });
    await seed(3);
    expect(await verifyChain()).toEqual({ ok: true, checked: 3 });
  });

  it('detects an entry edited through the raw collection', async () => {
    const ids = await seed(4);
    await rawAuditLogs().updateOne({ seq: 2 }, { $set: { action: 'auth.logout' } });
    expect(await verifyChain()).toEqual({
      ok: false,
      checked: 2,
      firstBrokenId: ids[1],
      reason: 'hash_mismatch',
    });
  });

  it('detects a deleted entry (the next one no longer links)', async () => {
    const ids = await seed(4);
    await rawAuditLogs().deleteOne({ seq: 2 });
    expect(await verifyChain()).toMatchObject({
      ok: false,
      firstBrokenId: ids[2],
      reason: 'prev_hash_mismatch',
    });
  });

  it('detects a re-linked entry', async () => {
    const ids = await seed(3);
    await rawAuditLogs().updateOne({ seq: 3 }, { $set: { prevHash: 'forged' } });
    // prevHash is covered by the hash, so re-linking also breaks the entry's own hash.
    expect(await verifyChain()).toMatchObject({ ok: false, firstBrokenId: ids[2] });
  });
});

describe('diffChanges', () => {
  it('keeps only changed fields, compared by value', () => {
    const at = new Date('2026-01-01T00:00:00Z');
    expect(
      diffChanges(
        { firstName: 'A', lastName: 'B', isActive: true, at, tags: ['x'] },
        { firstName: 'A', lastName: 'C', isActive: false, at: new Date(at), tags: ['x'] },
        ['firstName', 'lastName', 'isActive', 'at', 'tags'],
      ),
    ).toEqual({
      fields: ['lastName', 'isActive'],
      before: { lastName: 'B', isActive: true },
      after: { lastName: 'C', isActive: false },
    });
  });

  it('records that contact details changed without their values', () => {
    expect(diffChanges({ email: 'a@x.dev' }, { email: 'b@x.dev' }, ['email'])).toEqual({
      fields: ['email'],
      before: { email: '[REDACTED]' },
      after: { email: '[REDACTED]' },
    });
  });

  it('returns no fields when nothing changed', () => {
    expect(diffChanges({ a: 1 }, { a: 1 }, ['a']).fields).toEqual([]);
  });
});
