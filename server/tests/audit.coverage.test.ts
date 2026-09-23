import { AUDIT_ACTIONS } from '../src/config/constants.js';
import { AuditLog } from '../src/modules/audit/model.js';
import { Session } from '../src/modules/sessions/model.js';
import { flushAudit } from '../src/services/audit.service.js';
import { addDaysToDate, clinicToday } from '../src/utils/dates.js';
import { hashToken, verifyAccessToken } from '../src/utils/tokens.js';
import {
  createUser,
  loginAs,
  refreshCookieFrom,
  refreshWith,
  resetDb,
  TEST_PASSWORD,
} from './helpers/auth.js';
import { captureEmails } from './helpers/email.js';
import { api } from './helpers/testApp.js';

/**
 * Every action in AUDIT_ACTIONS is written by the real endpoints (spec §10.4), and no audit
 * entry ever contains a password, token, hash or cookie. When a phase adds an action, add the
 * step that triggers it here.
 */
/**
 * Actions no endpoint can trigger yet. clinical_profile_update needs a doctor with a care
 * relationship (Phase 5); patients.clinicalProfile.test.ts covers it with a stand-in policy.
 */
const NOT_REACHABLE_YET = new Set<string>([AUDIT_ACTIONS.PATIENT_CLINICAL_PROFILE_UPDATE]);

describe('audit coverage', () => {
  it('writes every action, with no secrets in any entry', async () => {
    await resetDb();
    const emails = captureEmails();
    const secrets: string[] = [TEST_PASSWORD];
    const keep = (...values: (string | undefined)[]) =>
      secrets.push(...values.filter((v): v is string => Boolean(v)));

    // auth.register
    const reg = await api().post('/api/v1/auth/register').send({
      firstName: 'Neha',
      lastName: 'Gupta',
      email: 'neha@example.com',
      phone: '+919812345678',
      dateOfBirth: '1992-03-04',
      password: 'Audit-2026-pass',
      acceptTerms: true,
    });
    keep('Audit-2026-pass', reg.body.data.accessToken, refreshCookieFrom(reg));

    // auth.login, auth.login_failed
    const admin = await loginAs('admin');
    keep(admin.token, admin.refreshToken);
    await api()
      .post('/api/v1/auth/login')
      .send({ email: admin.user.email, password: 'Wrong-pass-1' });

    // auth.profile_update
    await api().patch('/api/v1/auth/me').set(admin.auth).send({ phone: '+919800000009' });

    // user.create, user.update, user.deactivate, user.activate, user.unlock, user.reset_password
    const created = await api().post('/api/v1/users').set(admin.auth).send({
      firstName: 'Ravi',
      lastName: 'Kumar',
      email: 'ravi@clinic.dev',
      role: 'receptionist',
    });
    const id = created.body.data.id as string;
    await api().patch(`/api/v1/users/${id}`).set(admin.auth).send({ lastName: 'Rao' });
    await api().post(`/api/v1/users/${id}/deactivate`).set(admin.auth);
    await api().post(`/api/v1/users/${id}/activate`).set(admin.auth);
    await api().post(`/api/v1/users/${id}/unlock`).set(admin.auth);
    await api().post(`/api/v1/users/${id}/reset-password`).set(admin.auth);

    // access.denied, audit.verify
    const doctor = await loginAs('doctor');
    keep(doctor.token, doctor.refreshToken);
    await api().get('/api/v1/users').set(doctor.auth);
    await api().get('/api/v1/audit-logs/verify').set(admin.auth);

    // auth.session_revoke (a second login of the doctor), auth.logout_all
    const second = await api()
      .post('/api/v1/auth/login')
      .send({ email: doctor.user.email, password: TEST_PASSWORD });
    keep(second.body.data.accessToken, refreshCookieFrom(second));
    await api()
      .delete(`/api/v1/auth/sessions/${verifyAccessToken(second.body.data.accessToken).sid}`)
      .set(doctor.auth);
    await api().post('/api/v1/auth/logout-all').set(doctor.auth);

    // auth.refresh_reuse: reuse a rotated token after the grace window
    const lab = await loginAs('labtech');
    keep(lab.token, lab.refreshToken);
    const rotated = await refreshWith(lab.refreshToken);
    keep(rotated.body.data.accessToken, refreshCookieFrom(rotated));
    await Session.updateOne(
      { refreshTokenHash: hashToken(lab.refreshToken) },
      { $set: { revokedAt: new Date(Date.now() - 60_000) } },
    );
    await refreshWith(lab.refreshToken);

    // auth.password_changed, auth.password_reset_requested, auth.password_reset, auth.logout
    const staff = await createUser('receptionist', { firstName: 'Kiran' });
    const staffLogin = await api()
      .post('/api/v1/auth/login')
      .send({ email: staff.email, password: TEST_PASSWORD });
    const staffAuth = { Authorization: `Bearer ${staffLogin.body.data.accessToken}` };
    const changed = await api()
      .post('/api/v1/auth/change-password')
      .set(staffAuth)
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'Changed-2026-pw' });
    keep('Changed-2026-pw', staffLogin.body.data.accessToken, changed.body.data.accessToken);
    await api().post('/api/v1/auth/forgot-password').send({ email: staff.email });
    await emails.lastToken();
    const token = emails.sent.at(-1)?.links?.[0]?.split('/').at(-1);
    keep(token);
    await api().post('/api/v1/auth/reset-password').send({ token, newPassword: 'Reset-2026-pw' });
    keep('Reset-2026-pw');
    const again = await api()
      .post('/api/v1/auth/login')
      .send({ email: staff.email, password: 'Reset-2026-pw' });
    await api()
      .post('/api/v1/auth/logout')
      .set({ Authorization: `Bearer ${again.body.data.accessToken}` });

    // settings.update
    await api().patch('/api/v1/settings').set(admin.auth).send({ tagline: 'Audit tagline' });

    // department.create, department.update, department.deactivate, department.activate
    const dept = await api()
      .post('/api/v1/departments')
      .set(admin.auth)
      .send({ name: 'Audit Dept', code: 'AUD' });
    const deptId = dept.body.data.id as string;
    await api().patch(`/api/v1/departments/${deptId}`).set(admin.auth).send({ description: 'x' });
    await api().post(`/api/v1/departments/${deptId}/deactivate`).set(admin.auth);
    await api().post(`/api/v1/departments/${deptId}/activate`).set(admin.auth);

    // service.create, service.update, service.deactivate, service.activate
    const svc = await api().post('/api/v1/services').set(admin.auth).send({
      code: 'AUD-1',
      name: 'Audit service',
      department: deptId,
      type: 'consultation',
      pricePaise: 50_000,
    });
    const svcId = svc.body.data.id as string;
    await api().patch(`/api/v1/services/${svcId}`).set(admin.auth).send({ pricePaise: 55_000 });
    await api().post(`/api/v1/services/${svcId}/deactivate`).set(admin.auth);
    await api().post(`/api/v1/services/${svcId}/activate`).set(admin.auth);

    // doctor.create, doctor.update
    const dr = await api().post('/api/v1/doctors').set(admin.auth).send({
      firstName: 'Kavya',
      lastName: 'Iyer',
      email: 'kavya@clinic.dev',
      department: deptId,
      specialization: 'Paediatrician',
      registrationNumber: 'AUD-REG-1',
    });
    keep(await emails.lastToken());
    const drId = dr.body.data.id as string;
    await api().patch(`/api/v1/doctors/${drId}`).set(admin.auth).send({ bio: 'Child health' });

    // doctor.schedule_update, doctor.leave_create, doctor.leave_cancel
    const soon = addDaysToDate(clinicToday('Asia/Kolkata'), 7);
    await api()
      .put(`/api/v1/doctors/${drId}/schedule`)
      .set(admin.auth)
      .send({
        effectiveFrom: soon,
        days: [{ weekday: 1, sessions: [{ start: '09:00', end: '13:00' }] }],
      });
    const leave = await api()
      .post(`/api/v1/doctors/${drId}/leaves`)
      .set(admin.auth)
      .send({ date: soon, fullDay: true });
    await api()
      .post(`/api/v1/doctors/${drId}/leaves/${leave.body.data.leave.id}/cancel`)
      .set(admin.auth);

    // lab_test.create, lab_test.update, lab_test.deactivate, lab_test.activate
    const test = await api()
      .post('/api/v1/lab-tests')
      .set(admin.auth)
      .send({
        code: 'AUD-T',
        name: 'Audit test',
        category: 'other',
        sampleType: 'blood',
        pricePaise: 100,
        parameters: [{ key: 'v', name: 'Value', valueType: 'text' }],
      });
    const testId = test.body.data.id as string;
    await api().patch(`/api/v1/lab-tests/${testId}`).set(admin.auth).send({ pricePaise: 200 });
    await api().post(`/api/v1/lab-tests/${testId}/deactivate`).set(admin.auth);
    await api().post(`/api/v1/lab-tests/${testId}/activate`).set(admin.auth);
    // patient.create, patient.create_duplicate_override, patient.view, patient.update,
    // patient.update_duplicate_override, patient.deactivate, patient.activate
    const reception = await loginAs('receptionist');
    keep(reception.token, reception.refreshToken);
    const patientBody = {
      firstName: 'Anita',
      lastName: 'Desai',
      dateOfBirth: '1980-01-02',
      gender: 'female',
      phone: '9812300001',
      consent: { dataProcessing: true },
    };
    const patient = await api().post('/api/v1/patients').set(reception.auth).send(patientBody);
    const patientId = patient.body.data.id as string;
    const twin = await api()
      .post('/api/v1/patients')
      .set(reception.auth)
      .send({
        ...patientBody,
        firstName: 'Sunita',
        force: true,
        reason: 'Twin sister, same phone',
      });
    await api().get(`/api/v1/patients/${patientId}`).set(reception.auth);
    await api()
      .patch(`/api/v1/patients/${patientId}`)
      .set(reception.auth)
      .send({ allergies: [{ substance: 'Latex', severity: 'mild' }] });
    await api()
      .patch(`/api/v1/patients/${twin.body.data.id}`)
      .set(reception.auth)
      .send({ dateOfBirth: '1980-01-03' });
    await api()
      .patch(`/api/v1/patients/${twin.body.data.id}`)
      .set(reception.auth)
      .send({ dateOfBirth: '1980-01-02', force: true, reason: 'Corrected: twins share a DOB' });
    await api()
      .post(`/api/v1/patients/${patientId}/deactivate`)
      .set(admin.auth)
      .send({ reason: 'Moved away' });
    await api()
      .post(`/api/v1/patients/${patientId}/activate`)
      .set(admin.auth)
      .send({ reason: 'Came back' });
    emails.restore();

    await flushAudit();
    const entries = await AuditLog.find().lean();
    const written = new Set(entries.map((e) => e.action));
    const missing = Object.values(AUDIT_ACTIONS).filter(
      (a) => !written.has(a) && !NOT_REACHABLE_YET.has(a),
    );
    expect(missing).toEqual([]);

    const stored = JSON.stringify(entries);
    for (const secret of secrets) expect(stored).not.toContain(secret);
    for (const secret of secrets) expect(stored).not.toContain(hashToken(secret));
    expect(stored).not.toMatch(/passwordHash"|refreshTokenHash|ma_rt=|\$2[aby]\$/);
  });
});
