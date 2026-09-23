import { SESSION_REVOKE_REASONS } from '../../src/config/constants.js';
import { Session } from '../../src/modules/sessions/model.js';

describe('Session model', () => {
  beforeAll(async () => {
    await Session.init();
  });

  it('has a TTL index on expiresAt, a unique refreshTokenHash and indexes on user and family', async () => {
    const indexes = await Session.collection.indexes();
    const byKey = (key: object) =>
      indexes.find((i) => JSON.stringify(i.key) === JSON.stringify(key));

    expect(byKey({ expiresAt: 1 })).toMatchObject({ expireAfterSeconds: 0 });
    expect(byKey({ refreshTokenHash: 1 })).toMatchObject({ unique: true });
    expect(byKey({ user: 1 })).toBeDefined();
    expect(byKey({ family: 1 })).toBeDefined();
  });

  it('accepts every revoke reason, including rotated and deactivated', async () => {
    expect(SESSION_REVOKE_REASONS).toEqual(
      expect.arrayContaining(['rotated', 'deactivated', 'reuse_detected']),
    );
    const bad = new Session({
      user: '64b000000000000000000001',
      refreshTokenHash: 'h',
      family: 'f',
      expiresAt: new Date(),
      revokedReason: 'bored',
    });
    await expect(bad.validate()).rejects.toThrow(/revokedReason/);
  });
});
