import { emailService, type EmailMessage } from '../../src/services/email.service.js';

/** Captures every email sent while the returned spy is active (nothing is actually sent). */
export function captureEmails() {
  const sent: EmailMessage[] = [];
  const spy = vi.spyOn(emailService, 'send').mockImplementation(async (m) => {
    sent.push(m);
  });
  return {
    sent,
    restore: () => spy.mockRestore(),
    /** Waits for a background send and returns the token from the last link in it. */
    async lastToken(): Promise<string> {
      await vi.waitFor(() => expect(sent.length).toBeGreaterThan(0));
      const link = sent.at(-1)?.links?.at(-1) ?? '';
      return link.split('/').at(-1) ?? '';
    },
  };
}
