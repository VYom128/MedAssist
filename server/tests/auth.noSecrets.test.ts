import { captureEmails } from './helpers/email.js';
import { createUser, loginAs, refreshWith, resetDb, TEST_PASSWORD } from './helpers/auth.js';
import { api } from './helpers/testApp.js';

/** Anything that looks like a stored secret must never appear in an API response. */
const FORBIDDEN = /passwordHash|passwordReset|refreshTokenHash|tokenHash|"\$2[aby]\$/;

describe('responses never expose secrets', () => {
  beforeEach(resetDb);

  it('across every Phase 1 endpoint that returns user or session data', async () => {
    const emails = captureEmails();
    const admin = await loginAs('admin');
    const patient = await loginAs('patient');
    const staff = await createUser('labtech');

    const responses = [
      await api()
        .post('/api/v1/auth/register')
        .send({
          firstName: 'Neha',
          lastName: 'Gupta',
          email: 'neha@example.com',
          phone: '+919812345678',
          dateOfBirth: '1992-03-04',
          password: 'Clinic2026!pass',
          acceptTerms: true,
          consent: { dataProcessing: true },
        }),
      await api().post('/api/v1/auth/login').send({ email: staff.email, password: TEST_PASSWORD }),
      await refreshWith(patient.refreshToken),
      await api().get('/api/v1/auth/me').set(admin.auth),
      await api().patch('/api/v1/auth/me').set(admin.auth).send({ firstName: 'Asha' }),
      await api().get('/api/v1/auth/sessions').set(admin.auth),
      await api().get('/api/v1/users').set(admin.auth),
      await api().get(`/api/v1/users/${staff._id}`).set(admin.auth),
      await api()
        .post('/api/v1/users')
        .set(admin.auth)
        .send({ firstName: 'R', lastName: 'K', email: 'rk@clinic.dev', role: 'receptionist' }),
      await api().post(`/api/v1/users/${staff._id}/unlock`).set(admin.auth),
      await api().post('/api/v1/auth/forgot-password').send({ email: staff.email }),
      await api().get('/api/v1/audit-logs?limit=100').set(admin.auth),
    ];

    for (const [i, res] of responses.entries()) {
      expect(res.status, `response #${i}`).toBeLessThan(300);
      expect(JSON.stringify(res.body), `response #${i}`).not.toMatch(FORBIDDEN);
      expect(JSON.stringify(res.body)).not.toContain(TEST_PASSWORD);
    }
    emails.restore();
  });
});
