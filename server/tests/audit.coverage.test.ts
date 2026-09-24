import { AUDIT_ACTIONS } from '../src/config/constants.js';
import { AuditLog } from '../src/modules/audit/model.js';
import { Session } from '../src/modules/sessions/model.js';
import { flushAudit } from '../src/services/audit.service.js';
import {
  addDaysToDate,
  clinicToday,
  startOfClinicDay,
  weekdayOf,
  zonedDateTimeToUtc,
} from '../src/utils/dates.js';
import { hashToken, verifyAccessToken } from '../src/utils/tokens.js';
import { runPrescriptionCompletionJob } from '../src/jobs/prescriptionCompletion.job.js';
import {
  createUser,
  loginAs,
  refreshCookieFrom,
  refreshWith,
  resetDb,
  TEST_PASSWORD,
} from './helpers/auth.js';
import { captureEmails } from './helpers/email.js';
import { insertAppointment, loginAsDoctor } from './helpers/fixtures.js';
import { api } from './helpers/testApp.js';

/**
 * Every action in AUDIT_ACTIONS is written by the real endpoints (spec §10.4), and no audit
 * entry ever contains a password, token, hash or cookie. When a phase adds an action, add the
 * step that triggers it here.
 */
/** Actions no endpoint can trigger yet. */
const NOT_REACHABLE_YET = new Set<string>([]);

describe('audit coverage', () => {
  it('writes every action, with no secrets in any entry', async () => {
    await resetDb();
    const emails = captureEmails();
    const secrets: string[] = [TEST_PASSWORD];
    const keep = (...values: (string | undefined)[]) =>
      secrets.push(...values.filter((v): v is string => Boolean(v)));

    // auth.register
    const reg = await api()
      .post('/api/v1/auth/register')
      .send({
        firstName: 'Neha',
        lastName: 'Gupta',
        email: 'neha@example.com',
        phone: '+919812345678',
        dateOfBirth: '1992-03-04',
        password: 'Audit-2026-pass',
        acceptTerms: true,
        consent: { dataProcessing: true },
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

    // patient.portal_invite
    await api()
      .patch(`/api/v1/patients/${patientId}`)
      .set(reception.auth)
      .send({ email: 'anita@example.com' });
    await api().post(`/api/v1/patients/${patientId}/portal-invite`).set(reception.auth);
    keep(await emails.lastToken());

    // patient.link_confirm, patient.link_reject: two sign-ups matching the twins' phone + DOB
    const signup = {
      firstName: 'Sunita',
      lastName: 'Desai',
      phone: '9812300001',
      dateOfBirth: '1980-01-02',
      password: 'Signup-2026-pass',
      acceptTerms: true,
      consent: { dataProcessing: true },
    };
    keep('Signup-2026-pass');
    const pending = await api()
      .post('/api/v1/auth/register')
      .send({ ...signup, email: 'sunita@example.com' });
    keep(pending.body.data.accessToken, refreshCookieFrom(pending));
    await api()
      .post(`/api/v1/patients/${twin.body.data.id}/reject-link`)
      .set(reception.auth)
      .send({ userId: pending.body.data.user.id, reason: 'Not the same person' });
    const sunitaAgain = await api()
      .post('/api/v1/auth/register')
      .send({ ...signup, email: 'sunita.two@example.com' });
    keep(sunitaAgain.body.data.accessToken, refreshCookieFrom(sunitaAgain));
    await api()
      .post(`/api/v1/patients/${twin.body.data.id}/confirm-link`)
      .set(reception.auth)
      .send({ userId: sunitaAgain.body.data.user.id });

    // appointment.create, appointment.update, appointment.reschedule, appointment.cancel:
    // Dr Iyer works Mondays 09:00–13:00 from `soon` (schedule above).
    let monday = soon;
    while (weekdayOf(monday) !== 1) monday = addDaysToDate(monday, 1);
    const appt = await api()
      .post('/api/v1/appointments')
      .set(reception.auth)
      .send({
        patientId,
        doctorId: drId,
        serviceId: svcId,
        startAt: zonedDateTimeToUtc(monday, '09:00', 'Asia/Kolkata'),
      });
    const apptId = appt.body.data.id as string;
    await api()
      .patch(`/api/v1/appointments/${apptId}`)
      .set(reception.auth)
      .send({ priority: 'priority' });
    await api()
      .post(`/api/v1/appointments/${apptId}/reschedule`)
      .set(reception.auth)
      .send({
        startAt: zonedDateTimeToUtc(monday, '09:30', 'Asia/Kolkata'),
        reason: 'Patient asked',
      });
    await api()
      .post(`/api/v1/appointments/${apptId}/cancel`)
      .set(reception.auth)
      .send({ reason: 'Patient called' });

    // appointment.check_in, .priority_change, .start, .complete, .no_show, .undo_no_show:
    // today's appointments (one minute each, just after clinic midnight, so already started).
    const drToday = await loginAsDoctor();
    keep(drToday.token, drToday.refreshToken);
    const today = clinicToday('Asia/Kolkata');
    const minute = (m: number) =>
      new Date(startOfClinicDay(today, 'Asia/Kolkata').getTime() + m * 60_000);
    const visit = await insertAppointment({
      patient: patientId,
      doctor: drToday.id,
      startAt: minute(1),
      minutes: 1,
    });
    const post = (path: string, auth: { Authorization: string }, body: object = {}) =>
      api().post(`/api/v1${path}`).set(auth).send(body);
    await post(`/appointments/${visit._id}/check-in`, reception.auth);
    await post(`/queue/${visit._id}/priority`, reception.auth, {
      priority: 'priority',
      reason: 'Elderly patient',
    });
    await post(`/appointments/${visit._id}/start`, drToday.auth);
    // encounter.create (with the start), encounter.view, encounter.update, and
    // patient.clinical_profile_update (drToday now has a care relationship with the patient)
    const note = await api().get(`/api/v1/appointments/${visit._id}/encounter`).set(drToday.auth);
    const noteId = note.body.data.id as string;
    await api()
      .patch(`/api/v1/encounters/${noteId}`)
      .set(drToday.auth)
      .send({
        expectedVersion: 0,
        chiefComplaint: 'Headache for two days',
        diagnoses: [{ description: 'Tension headache' }],
      });
    await api()
      .patch(`/api/v1/patients/${patientId}/clinical-profile`)
      .set(drToday.auth)
      .send({ chronicConditions: [{ name: 'Migraine' }] });
    // prescription.update, encounter.sign + prescription.issue + appointment.complete (signing)
    const rx = await api()
      .put(`/api/v1/encounters/${noteId}/prescription`)
      .set(drToday.auth)
      .send({
        items: [{ drugName: 'Paracetamol', dose: '1 tablet', frequency: 'SOS', durationDays: 3 }],
      });
    await post(`/encounters/${noteId}/sign`, drToday.auth, { expectedVersion: 1 });
    // prescription.view, encounter.amend, prescription.cancel + prescription.reissue, then the
    // reissued draft is issued and completed by the job (prescription.complete)
    await api().get(`/api/v1/prescriptions/${rx.body.data.id}`).set(drToday.auth);
    await post(`/encounters/${noteId}/amendments`, drToday.auth, {
      reason: 'Added the plan after the call',
      changes: { plan: 'Hydration and rest' },
    });
    const reissued = await post(`/prescriptions/${rx.body.data.id}/reissue`, drToday.auth, {
      reason: 'Change to a regular dose',
    });
    await post(`/prescriptions/${reissued.body.data.id}/issue`, drToday.auth);
    await runPrescriptionCompletionJob(new Date(Date.now() + 10 * 86_400_000));
    const missed = await insertAppointment({
      patient: twin.body.data.id as string,
      doctor: drToday.id,
      startAt: minute(2),
      minutes: 1,
    });
    await post(`/appointments/${missed._id}/no-show`, reception.auth);
    await post(`/appointments/${missed._id}/undo-no-show`, reception.auth);
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
