import { ageOn, isValidDateOfBirth, subtractYears } from '../../src/utils/dates.js';
import { buildPatientSearchQuery, escapeRegex } from '../../src/utils/search.js';

describe('buildPatientSearchQuery', () => {
  it('returns null for an empty query', () => {
    expect(buildPatientSearchQuery('   ')).toBeNull();
  });

  it.each(['MRN-000123', 'mrn-123', 'MRN 123', 'mrn123'])('%s → exact MRN', (q) => {
    expect(buildPatientSearchQuery(q)).toEqual({ mrn: 'MRN-000123' });
  });

  it.each(['+91 98765 43210', '09876543210', '9876543210', '98765-43210'])(
    '%s → exact E.164 phone',
    (q) => {
      expect(buildPatientSearchQuery(q)).toEqual({ phone: '+919876543210' });
    },
  );

  it('an invalid phone-like term matches nothing (not a name search)', () => {
    expect(buildPatientSearchQuery('1234567')).toEqual({ _id: { $exists: false } });
  });

  it('one word → anchored, case-insensitive prefix of first or last name', () => {
    const query = buildPatientSearchQuery('pri') as { $or: { firstName?: RegExp }[] };
    const regex = query.$or[0]!.firstName!;
    expect(regex.source).toBe('^pri');
    expect(regex.flags).toBe('i');
    expect(query.$or[1]).toEqual({ lastName: regex });
  });

  it('several words → every word must match (AND), each as a prefix', () => {
    const query = buildPatientSearchQuery('  Priya   Sha ') as { $and: unknown[] };
    expect(query.$and).toHaveLength(2);
    expect(JSON.stringify(query)).not.toContain('.*');
  });

  it('escapes regex characters (no injection, no leading wildcard)', () => {
    const query = buildPatientSearchQuery('a.*(b') as { $or: { firstName: RegExp }[] };
    expect(query.$or[0]!.firstName.source).toBe(`^${escapeRegex('a.*(b')}`);
  });
});

describe('ages and dates of birth', () => {
  it('computes age in whole years on a clinic date', () => {
    expect(ageOn('1990-05-17', '2026-05-16')).toBe(35);
    expect(ageOn('1990-05-17', '2026-05-17')).toBe(36);
    expect(ageOn(new Date('2020-02-29T00:00:00Z'), '2025-02-28')).toBe(4);
    expect(ageOn(new Date('2020-02-29T00:00:00Z'), '2025-03-01')).toBe(5);
  });

  it('subtracts calendar years', () => {
    expect(subtractYears('2026-09-24', 30)).toBe('1996-09-24');
    expect(subtractYears('2024-02-29', 1)).toBe('2023-02-28');
  });

  it('accepts only past dates within 120 years', () => {
    const now = new Date('2026-09-24T06:00:00Z');
    expect(isValidDateOfBirth('2026-09-24', now)).toBe(true); // born today
    expect(isValidDateOfBirth('2026-09-26', now)).toBe(false);
    expect(isValidDateOfBirth('1906-09-24', now)).toBe(true);
    expect(isValidDateOfBirth('1906-09-22', now)).toBe(false);
    expect(isValidDateOfBirth('1990-02-30', now)).toBe(false);
  });
});
