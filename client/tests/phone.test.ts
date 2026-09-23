import { formatPhone, isBlankPhone, normalisePhone } from '../src/utils/phone';

describe('phone utils', () => {
  it.each(['+91 98765 43210', '09876543210', '9876543210', '98765-43210'])('normalises %s', (v) =>
    expect(normalisePhone(v)).toBe('+919876543210'),
  );
  it('rejects invalid numbers', () => {
    expect(normalisePhone('12345')).toBeNull();
  });
  it('formats for display', () => {
    expect(formatPhone('+919876543210')).toBe('+91 98765 43210');
    expect(formatPhone(null)).toBe('—');
  });
  it('treats the bare +91 prefix as blank', () => {
    expect(isBlankPhone('+91 ')).toBe(true);
    expect(isBlankPhone('+91 98')).toBe(false);
  });
});
