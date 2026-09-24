import { auditEntries, loginAs, resetDb } from './helpers/auth.js';
import { createPatient, insertAppointment } from './helpers/fixtures.js';
import { api } from './helpers/testApp.js';

/**
 * PATCH /patients/:id/clinical-profile (spec §7.7) – doctors with a care relationship (a
 * non-cancelled appointment with the patient, spec §2.3) record allergies and chronic
 * conditions; everyone else gets 404 or 403.
 */
async function relate(doctorId: string, patientId: string, status = 'completed') {
  await insertAppointment({
    patient: patientId,
    doctor: doctorId,
    startAt: new Date(Date.now() - 3 * 86_400_000 + Math.floor(Math.random() * 1e6)),
    status,
    isSlotActive: false,
  });
}

describe('clinical profile (doctor with a care relationship)', () => {
  beforeEach(resetDb);

  it('records allergies and chronic conditions with recordedBy/At, audited without values', async () => {
    const { id } = await createPatient({
      allergies: [{ substance: 'Dust', severity: 'mild', recordedAt: new Date(0) }],
    });
    const doctor = await loginAs('doctor');
    await relate(doctor.user._id.toString(), id);
    const current = await api().get(`/api/v1/patients/${id}`).set(doctor.auth);
    expect(current.status).toBe(200);
    expect(current.body.data).not.toHaveProperty('adminNotes');
    expect(current.body.data).not.toHaveProperty('insurance');
    const dust = current.body.data.allergies[0];

    const res = await api()
      .patch(`/api/v1/patients/${id}/clinical-profile`)
      .set(doctor.auth)
      .send({
        allergies: [{ id: dust.id, substance: 'Dust', severity: 'mild' }],
        chronicConditions: [
          { name: 'Type 2 diabetes', since: '2019-03-01', notes: 'On metformin' },
        ],
      });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.allergies).toEqual([dust]);
    expect(res.body.data.chronicConditions).toEqual([
      expect.objectContaining({
        name: 'Type 2 diabetes',
        since: '2019-03-01',
        recordedBy: doctor.user.id,
        recordedAt: expect.any(String),
      }),
    ]);

    const [entry] = await auditEntries('patient.clinical_profile_update');
    expect(entry?.changes?.fields).toEqual(['chronicConditions']);
    expect(JSON.stringify(entry)).not.toMatch(/diabetes|metformin/i);
  });

  it('a doctor without the relationship gets 404 (audited) and nothing changes', async () => {
    const { id } = await createPatient();
    const other = await loginAs('doctor');
    await relate(other.user._id.toString(), id);
    const doctor = await loginAs('doctor');
    await relate(doctor.user._id.toString(), id, 'cancelled'); // cancelled only: no relationship
    const res = await api()
      .patch(`/api/v1/patients/${id}/clinical-profile`)
      .set(doctor.auth)
      .send({ chronicConditions: [{ name: 'Asthma' }] });
    expect(res.status).toBe(404);
    expect((await auditEntries('access.denied'))[0]?.patient?.toString()).toBe(id);
    expect(await auditEntries('patient.clinical_profile_update')).toHaveLength(0);
  });

  it('admins and receptionists cannot use it (403)', async () => {
    const { id } = await createPatient();
    for (const role of ['admin', 'receptionist'] as const) {
      const res = await api()
        .patch(`/api/v1/patients/${id}/clinical-profile`)
        .set((await loginAs(role)).auth)
        .send({ chronicConditions: [] });
      expect(res.status).toBe(403);
    }
  });
});
