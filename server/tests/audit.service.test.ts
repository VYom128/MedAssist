import { Types } from 'mongoose';
import { AUDIT_ACTIONS, AUDIT_GENESIS_HASH } from '../src/config/constants.js';
import { AuditLog } from '../src/modules/audit/model.js';
import { verifyChain } from '../src/modules/audit/service.js';
import * as audit from '../src/services/audit.service.js';
import { logger } from '../src/utils/logger.js';

async function wipe() {
  await audit.flushAudit();
  await AuditLog.collection.deleteMany({}); // raw driver call: bypasses the append-only hooks
  audit.resetAuditChainCache();
}

const actor = { user: new Types.ObjectId().toString(), role: 'admin', name: 'Asha Admin' };

describe('audit service', () => {
  beforeEach(wipe);

  it('writes linked entries with increasing seq and a valid chain', async () => {
    await audit.record({ action: AUDIT_ACTIONS.AUTH_LOGIN, actor });
    await audit.record({
      action: AUDIT_ACTIONS.USER_UPDATE,
      actor,
      resource: { type: 'user', id: new Types.ObjectId() },
      changes: { fields: ['firstName'], before: { firstName: 'A' }, after: { firstName: 'B' } },
      metadata: { at: new Date(), nested: { z: 1, a: [1, 2] } },
      request: { id: 'req-12345678', method: 'PATCH', path: '/api/v1/users/x', ip: '::1' },
    });
    await audit.record({ action: AUDIT_ACTIONS.AUTH_LOGOUT });

    const entries = await AuditLog.find().sort({ seq: 1 }).lean();
    expect(entries.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(entries[0]?.prevHash).toBe(AUDIT_GENESIS_HASH);
    expect(entries[1]?.prevHash).toBe(entries[0]?.hash);
    expect(entries[2]?.actor).toEqual({ user: null, role: null, name: null });

    await expect(verifyChain()).resolves.toEqual({ valid: true, checked: 3, firstBroken: null });
  });

  it('keeps the chain linear when many writes are fired at once', async () => {
    await Promise.all(
      Array.from({ length: 20 }, () => audit.record({ action: AUDIT_ACTIONS.AUTH_LOGIN, actor })),
    );
    const result = await verifyChain();
    expect(result).toMatchObject({ valid: true, checked: 20 });
  });

  it('blocks updates, deletes and bulk writes through Mongoose', async () => {
    await audit.record({ action: AUDIT_ACTIONS.AUTH_LOGIN, actor });
    const doc = await AuditLog.findOne();
    if (!doc) throw new Error('missing entry');

    await expect(AuditLog.updateOne({}, { action: 'x' })).rejects.toThrow(/append-only/);
    await expect(AuditLog.updateMany({}, { action: 'x' })).rejects.toThrow(/append-only/);
    await expect(AuditLog.findOneAndUpdate({}, { action: 'x' })).rejects.toThrow(/append-only/);
    await expect(AuditLog.replaceOne({}, { action: 'x' })).rejects.toThrow(/append-only/);
    await expect(AuditLog.deleteOne({})).rejects.toThrow(/append-only/);
    await expect(AuditLog.deleteMany({})).rejects.toThrow(/append-only/);
    await expect(AuditLog.findOneAndDelete({})).rejects.toThrow(/append-only/);
    await expect(doc.deleteOne()).rejects.toThrow(/append-only/);
    doc.action = 'tampered';
    await expect(doc.save()).rejects.toThrow(/append-only/);
    await expect(AuditLog.insertMany([{}])).rejects.toThrow(/append-only/);
    await expect(AuditLog.bulkWrite([{ deleteOne: { filter: {} } }])).rejects.toThrow(
      /append-only/,
    );

    expect(await AuditLog.countDocuments()).toBe(1);
  });

  it('detects edited, re-linked and deleted entries', async () => {
    for (let i = 0; i < 4; i++) await audit.record({ action: AUDIT_ACTIONS.AUTH_LOGIN, actor });

    await AuditLog.collection.updateOne({ seq: 2 }, { $set: { action: 'auth.logout' } });
    expect(await verifyChain()).toMatchObject({
      valid: false,
      firstBroken: { seq: 2, reason: 'hash_mismatch' },
    });

    await AuditLog.collection.updateOne({ seq: 2 }, { $set: { action: AUDIT_ACTIONS.AUTH_LOGIN } });
    await AuditLog.collection.updateOne({ seq: 3 }, { $set: { prevHash: 'forged' } });
    expect(await verifyChain()).toMatchObject({
      firstBroken: { seq: 3, reason: 'prev_hash_mismatch' },
    });

    await AuditLog.collection.deleteOne({ seq: 3 });
    expect(await verifyChain()).toMatchObject({ firstBroken: { seq: 4, reason: 'sequence_gap' } });
  });

  it('never rejects when a write fails, logs at error level, and recovers', async () => {
    const errorSpy = vi.spyOn(logger, 'error');
    const saveSpy = vi
      .spyOn(AuditLog.prototype, 'save')
      .mockRejectedValueOnce(new Error('disk full'));

    await expect(
      audit.record({ action: AUDIT_ACTIONS.AUTH_LOGIN, actor }),
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ action: AUDIT_ACTIONS.AUTH_LOGIN }),
      'Audit log write failed',
    );

    saveSpy.mockRestore();
    await audit.record({ action: AUDIT_ACTIONS.AUTH_LOGIN, actor });
    expect(await verifyChain()).toMatchObject({ valid: true, checked: 1 });
    errorSpy.mockRestore();
  });

  it('debounces reads of the same record by the same user within 5 minutes', async () => {
    const resource = { type: 'user', id: new Types.ObjectId() };
    const read = { action: AUDIT_ACTIONS.USER_UPDATE, actor, resource };
    await audit.recordRead(read);
    await audit.recordRead(read);
    await audit.recordRead({ ...read, resource: { type: 'user', id: new Types.ObjectId() } });
    expect(await AuditLog.countDocuments()).toBe(2);

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 6 * 60_000);
    await audit.recordRead(read);
    vi.useRealTimers();
    expect(await AuditLog.countDocuments()).toBe(3);
  });
});
