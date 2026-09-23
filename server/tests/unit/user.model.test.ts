import { User } from '../../src/modules/users/model.js';
import { hashPassword } from '../../src/utils/password.js';

const base = {
  firstName: 'Anil',
  lastName: 'Mehta',
  role: 'doctor',
  passwordHash: 'x',
};

describe('User model', () => {
  beforeAll(async () => {
    await User.init(); // build the unique index
  });
  beforeEach(async () => {
    await User.deleteMany({});
  });

  it('lowercases and trims the email', async () => {
    const user = await User.create({ ...base, email: '  Dr.Mehta@MedAssist.DEV ' });
    expect(user.email).toBe('dr.mehta@medassist.dev');
  });

  it('enforces a unique email (case-insensitive via lowercasing)', async () => {
    await User.create({ ...base, email: 'dr.mehta@medassist.dev' });
    await expect(User.create({ ...base, email: 'DR.MEHTA@medassist.dev' })).rejects.toMatchObject({
      code: 11000,
    });
  });

  it('requires names, email, role and passwordHash; rejects unknown roles', async () => {
    const err = await User.create({ role: 'wizard' }).catch((e: unknown) => e);
    expect(Object.keys((err as { errors: object }).errors).sort()).toEqual([
      'email',
      'firstName',
      'lastName',
      'passwordHash',
      'role',
    ]);
  });

  it('does not select passwordHash or passwordReset by default', async () => {
    await User.create({
      ...base,
      email: 'a@b.dev',
      passwordReset: { tokenHash: 'h', expiresAt: new Date() },
    });
    const loaded = await User.findOne({ email: 'a@b.dev' }).lean();
    expect(loaded).not.toHaveProperty('passwordHash');
    expect(loaded).not.toHaveProperty('passwordReset');
  });

  it('toJSON hides secrets and lockout state and adds fullName', async () => {
    await User.create({
      ...base,
      email: 'a@b.dev',
      failedLoginAttempts: 3,
      lockUntil: new Date(),
      passwordReset: { tokenHash: 'h', expiresAt: new Date() },
    });
    const user = await User.findOne({ email: 'a@b.dev' }).select('+passwordHash +passwordReset');
    const json = JSON.parse(JSON.stringify(user)) as Record<string, unknown>;
    for (const key of [
      'passwordHash',
      'passwordReset',
      'failedLoginAttempts',
      'lockUntil',
      '__v',
    ]) {
      expect(json).not.toHaveProperty(key);
    }
    expect(json).toMatchObject({
      fullName: 'Anil Mehta',
      email: 'a@b.dev',
      id: expect.any(String),
    });
  });

  it('comparePassword checks against the stored hash', async () => {
    await User.create({
      ...base,
      email: 'a@b.dev',
      passwordHash: await hashPassword('Clinic2026!pass'),
    });
    const user = await User.findOne({ email: 'a@b.dev' }).select('+passwordHash');
    await expect(user?.comparePassword('Clinic2026!pass')).resolves.toBe(true);
    await expect(user?.comparePassword('wrong-pass-1')).resolves.toBe(false);

    const withoutHash = await User.findOne({ email: 'a@b.dev' });
    expect(() => withoutHash?.comparePassword('x')).toThrow('passwordHash not selected');
  });

  it('leaves patient unset (the Patient model arrives in Phase 3)', async () => {
    const user = await User.create({ ...base, role: 'patient', email: 'p@b.dev' });
    expect(user.patient).toBeUndefined();
  });
});
