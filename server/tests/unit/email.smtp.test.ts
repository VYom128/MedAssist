/**
 * The SMTP transport (production, spec §18): config is read once at import, so each case sets the
 * environment, reloads the modules and replaces nodemailer with a fake – nothing is sent.
 */

const sendMail = vi.fn(async (_message: Record<string, unknown>) => ({ messageId: 'x' }));
const createTransport = vi.fn((_options: Record<string, unknown>) => ({ sendMail }));

async function loadWith(env: Record<string, string>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  vi.doMock('nodemailer', () => ({ default: { createTransport } }));
  return import('../../src/services/email.service.js');
}

const SMTP = {
  EMAIL_TRANSPORT: 'smtp',
  SMTP_HOST: 'smtp.example.test',
  SMTP_PORT: '587',
  MAIL_FROM: 'MedAssist <no-reply@example.test>',
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock('nodemailer');
  vi.resetModules();
  sendMail.mockClear();
  createTransport.mockClear();
});

describe('sendEmail (SMTP transport)', () => {
  it('sends from MAIL_FROM with STARTTLS on 587 and the login when both parts are set', async () => {
    const { sendEmail } = await loadWith({ ...SMTP, SMTP_USER: 'apikey', SMTP_PASS: 'pw' });
    await sendEmail({ to: 'a@b.dev', subject: 'Hi', text: 'Body', html: '<p>Body</p>' });
    await sendEmail({ to: 'c@d.dev', subject: 'Again', text: 'Body' });

    expect(createTransport).toHaveBeenCalledTimes(1); // one transporter, reused
    expect(createTransport).toHaveBeenCalledWith({
      host: 'smtp.example.test',
      port: 587,
      secure: false,
      auth: { user: 'apikey', pass: 'pw' },
    });
    expect(sendMail).toHaveBeenNthCalledWith(1, {
      from: 'MedAssist <no-reply@example.test>',
      to: 'a@b.dev',
      subject: 'Hi',
      text: 'Body',
      html: '<p>Body</p>',
    });
    expect(sendMail.mock.calls[1]![0]).not.toHaveProperty('html');
  });

  it('uses implicit TLS on 465 and no login when user or password is missing', async () => {
    const { sendEmail } = await loadWith({ ...SMTP, SMTP_PORT: '465', SMTP_USER: 'only-user' });
    await sendEmail({ to: 'a@b.dev', subject: 'Hi', text: 'Body' });
    expect(createTransport).toHaveBeenCalledWith({
      host: 'smtp.example.test',
      port: 465,
      secure: true,
    });
  });

  it('a failed send rejects (the notification queue retries it)', async () => {
    const { sendEmail } = await loadWith(SMTP);
    sendMail.mockRejectedValueOnce(Object.assign(new Error('454 auth'), { code: 'EAUTH' }));
    await expect(sendEmail({ to: 'a@b.dev', subject: 'Hi', text: 'Body' })).rejects.toThrow();
  });
});
