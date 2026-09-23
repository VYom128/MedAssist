import { passwordResetEmail, staffWelcomeEmail } from '../../src/services/email.templates.js';
import { sendEmail } from '../../src/services/email.service.js';
import { logger } from '../../src/utils/logger.js';

describe('email templates', () => {
  it('password reset has the link in text, html and links', () => {
    const t = passwordResetEmail('http://localhost:5173/reset-password/abc');
    expect(t.subject).toBe('Reset your MedAssist password');
    expect(t.text).toContain('http://localhost:5173/reset-password/abc');
    expect(t.html).toContain('href="http://localhost:5173/reset-password/abc"');
    expect(t.links).toEqual(['http://localhost:5173/reset-password/abc']);
  });

  it('staff welcome escapes the name in HTML', () => {
    const t = staffWelcomeEmail('<b>Ravi</b>', 'http://x/y');
    expect(t.html).toContain('&lt;b&gt;Ravi&lt;/b&gt;');
    expect(t.html).not.toContain('<b>Ravi</b>');
  });
});

describe('sendEmail (console transport)', () => {
  it('logs recipient, subject and links but not the body', async () => {
    const info = vi.spyOn(logger, 'info');
    await sendEmail({ to: 'a@b.dev', subject: 'Hi', text: 'secret body', links: ['http://x'] });
    expect(info).toHaveBeenCalledWith(
      { to: 'a@b.dev', subject: 'Hi', links: ['http://x'] },
      'Email (console transport)',
    );
    expect(JSON.stringify(info.mock.calls)).not.toContain('secret body');
    info.mockRestore();
  });
});
