import { formatPhone, normalisePhone, tryNormalisePhone } from '../../src/utils/phone.js';
import { phone } from '../../src/utils/zod.js';

describe('phone numbers', () => {
  it.each(['+91 98765 43210', '09876543210', '9876543210', '+91-98765-43210', '(+91) 98765 43210'])(
    '%s → +919876543210',
    (input) => {
      expect(normalisePhone(input)).toBe('+919876543210');
    },
  );

  it('keeps other countries when a +country code is given', () => {
    expect(normalisePhone('+1 415 555 2671')).toBe('+14155552671');
  });

  it.each(['12', '98765', 'not a phone', '+91 12345', ''])('rejects %j', (input) => {
    expect(tryNormalisePhone(input)).toBeNull();
    expect(() => normalisePhone(input)).toThrow('Enter a valid phone number');
  });

  it('formats a stored number for display', () => {
    expect(formatPhone('+919876543210')).toBe('+91 98765 43210');
    expect(formatPhone('+918041234567')).toBe('+91 80 4123 4567');
  });

  it('the Zod helper normalises or reports a field error', () => {
    expect(phone.parse('098765 43210')).toBe('+919876543210');
    const bad = phone.safeParse('12');
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.message).toBe('Enter a valid phone number');
  });
});
