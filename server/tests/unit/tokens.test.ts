import jwt from 'jsonwebtoken';
import { config } from '../../src/config/env.js';
import {
  AccessTokenError,
  generateOpaqueToken,
  hashToken,
  signAccessToken,
  verifyAccessToken,
} from '../../src/utils/tokens.js';

const payload = {
  sub: '64b000000000000000000001',
  role: 'doctor' as const,
  sid: '64b0000000000000000000aa',
};

const reasonOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return err instanceof AccessTokenError ? err.reason : 'other';
  }
  return 'none';
};

describe('access tokens', () => {
  it('signs sub, role, sid with a 15-minute expiry and verifies them', () => {
    const claims = verifyAccessToken(signAccessToken(payload));
    expect(claims).toMatchObject(payload);
    expect(claims.exp - claims.iat).toBe(config.auth.accessExpiresIn);
    expect(config.auth.accessExpiresIn).toBe(900);
  });

  it('reports an expired token as expired', () => {
    const expired = jwt.sign({ role: 'doctor', sid: payload.sid }, config.auth.accessSecret, {
      subject: payload.sub,
      expiresIn: -1,
    });
    expect(reasonOf(() => verifyAccessToken(expired))).toBe('expired');
  });

  it.each([
    ['garbage', 'not.a.jwt'],
    ['wrong secret', jwt.sign({ role: 'doctor', sid: 'x' }, 'y'.repeat(40), { subject: 'u' })],
    ['alg none', jwt.sign({ role: 'doctor', sid: 'x' }, '', { algorithm: 'none', subject: 'u' })],
    [
      'missing sid',
      jwt.sign({ role: 'doctor' }, config.auth.accessSecret, { subject: 'u', expiresIn: 60 }),
    ],
    ['string payload', jwt.sign('just-a-string', config.auth.accessSecret)],
  ])('reports %s as invalid', (_label, token) => {
    expect(reasonOf(() => verifyAccessToken(token))).toBe('invalid');
  });
});

describe('opaque tokens', () => {
  it('are 64 random bytes in base64url', () => {
    const token = generateOpaqueToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{86}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(64);
    expect(generateOpaqueToken()).not.toBe(token);
  });

  it('hash to SHA-256 hex, deterministically', () => {
    expect(hashToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
