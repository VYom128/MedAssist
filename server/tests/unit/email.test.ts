import { sendEmail } from '../../src/services/email.service.js';
import { NOTIFICATION_EMAILS } from '../../src/services/notificationEmails/index.js';
import { logger } from '../../src/utils/logger.js';

const ctx = { clinicName: 'MedAssist Clinic', timezone: 'Asia/Kolkata', data: {} };

describe('account email templates', () => {
  it('password reset has the link in text, html and links', () => {
    const url = 'http://localhost:5173/reset-password/abc';
    const t = NOTIFICATION_EMAILS['account.password_reset']({ ...ctx, url });
    expect(t.subject).toBe('Reset your MedAssist password');
    expect(t.text).toContain(url);
    expect(t.html).toContain(`href="${url}"`);
    expect(t.links).toEqual([url]);
  });

  it('staff welcome escapes the name in HTML', () => {
    const t = NOTIFICATION_EMAILS['account.created']({
      ...ctx,
      url: 'http://x/y',
      name: '<b>Ravi</b>',
    });
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
