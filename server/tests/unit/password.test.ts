import {
  checkPasswordStrength,
  hashPassword,
  isCommonPassword,
  PERSONAL_INFO_MESSAGE,
  verifyPassword,
} from '../../src/utils/password.js';

describe('checkPasswordStrength', () => {
  it('accepts a good password', () => {
    expect(checkPasswordStrength('Clinic2026!pass')).toEqual([]);
  });

  it.each([
    ['Ab1', 'Must be at least 8 characters'],
    ['OnlyLettersHere', 'Must contain a letter and a number'],
    ['1234567890', 'Must contain a letter and a number'],
    [`A1${'x'.repeat(71)}`, 'Must be at most 72 characters'],
    ['password1', 'This password is too common'],
    ['PASSW0RD', 'This password is too common'],
  ])('rejects %s', (password, problem) => {
    expect(checkPasswordStrength(password)).toContain(problem);
  });

  it('counts the 72-character limit in bytes (bcrypt), not characters', () => {
    const emoji = `A1${'😀'.repeat(18)}`; // 20 characters, 74 bytes
    expect(checkPasswordStrength(emoji)).toContain('Must be at most 72 characters');
  });

  it('lists every problem at once', () => {
    expect(checkPasswordStrength('abc')).toEqual([
      'Must be at least 8 characters',
      'Must contain a letter and a number',
    ]);
  });

  it('rejects passwords containing the email name or first name (case-insensitive)', () => {
    const personal = { email: 'priya.sharma@example.com', firstName: 'Priya' };
    expect(checkPasswordStrength('xPRIYAx2026', personal)).toContain(PERSONAL_INFO_MESSAGE);
    expect(checkPasswordStrength('priya.sharma99', personal)).toContain(PERSONAL_INFO_MESSAGE);
    expect(checkPasswordStrength('Clinic2026!pass', personal)).toEqual([]);
  });

  it('ignores very short names and email parts', () => {
    expect(checkPasswordStrength('Alpine2026!', { firstName: 'Al', email: 'al@x.dev' })).toEqual(
      [],
    );
  });

  it('isCommonPassword loads the bundled list', () => {
    expect(isCommonPassword('123456')).toBe(true);
    expect(isCommonPassword('Clinic2026!pass')).toBe(false);
  });
});

describe('hashPassword / verifyPassword', () => {
  it('hashes with bcrypt and verifies', async () => {
    const hash = await hashPassword('Clinic2026!pass');
    expect(hash).toMatch(/^\$2[aby]\$04\$/); // cost 4 in tests
    expect(hash).not.toContain('Clinic2026');
    await expect(verifyPassword('Clinic2026!pass', hash)).resolves.toBe(true);
    await expect(verifyPassword('clinic2026!pass', hash)).resolves.toBe(false);
  });

  it('salts each hash', async () => {
    expect(await hashPassword('Same-pass-1')).not.toBe(await hashPassword('Same-pass-1'));
  });
});
