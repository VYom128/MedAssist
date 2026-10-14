import { safeNextPath } from '../src/utils/forms';

/**
 * Post-login redirects (`/login?next=`) may only stay inside the app. Browsers read "\" as "/"
 * and drop tabs and newlines in URLs, so "/\evil.example" or "/\t/evil.example" would leave the
 * site (an open redirect – the same trick as React Router's CVE-2025-68470).
 */
describe('safeNextPath', () => {
  it.each([
    ['/profile', '/profile'],
    ['/admin/patients?q=ram#list', '/admin/patients?q=ram#list'],
    ['/reception/appointments?view=list', '/reception/appointments?view=list'],
  ])('keeps the in-app path %s', (next, expected) => {
    expect(safeNextPath(next)).toBe(expected);
  });

  it.each([
    [null],
    [''],
    ['profile'],
    ['https://evil.example/'],
    ['//evil.example'],
    ['/\\evil.example'],
    ['/\\/evil.example'],
    ['\\\\evil.example'],
    ['/\t/evil.example'],
    ['/\n/evil.example'],
    ['/%0d/evil.example'.replace('%0d', '\r')],
    ['javascript:alert(1)'],
  ])('refuses %j', (next) => {
    expect(safeNextPath(next)).toBeNull();
  });
});
