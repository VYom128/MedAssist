import { createScrubber, demographics, nameVariants, scrubText } from '../src/ai/deidentify.js';
import { lastPayload, mockPayloads, resetMock } from '../src/ai/providers/mock.js';
import { Patient } from '../src/modules/patients/model.js';
import { Appointment } from '../src/modules/appointments/model.js';
import { Encounter } from '../src/modules/encounters/model.js';
import { Prescription } from '../src/modules/prescriptions/model.js';
import { formatPhone } from '../src/utils/phone.js';
import { loginAs, resetDb } from './helpers/auth.js';
import { captureEmails } from './helpers/email.js';
import {
  addDoctorProfile,
  createPatient,
  readyToSign,
  rxItem,
  signNote,
  useMiddayClinicZone,
} from './helpers/fixtures.js';
import { api } from './helpers/testApp.js';

/**
 * De-identification (spec §9.1): pure helpers, and end to end – nothing that identifies the
 * patient or the doctor reaches the AI provider's payload.
 */

describe('deidentify helpers', () => {
  const names = nameVariants([
    { firstName: 'Asha', lastName: 'Verma' },
    { firstName: 'Rohan', lastName: 'Mehta' },
    'Kavita Rao',
  ]);

  it('lists full, first and last names, longest first', () => {
    expect(names.slice(0, 3)).toEqual(['Rohan Mehta', 'Asha Verma', 'Kavita Rao']);
    expect(names).toEqual(expect.arrayContaining(['Asha', 'Verma', 'Rohan', 'Mehta', 'Rao']));
    expect(nameVariants([{ firstName: 'A', lastName: null }])).toEqual([]);
  });

  it('replaces known names in any case, whole words only', () => {
    expect(scrubText('ASHA verma said Dr rohan MEHTA and Kavita Rao agreed', names)).toBe(
      '[name] said Dr [name] and [name] agreed',
    );
    expect(scrubText('Ashamed, Raoult, Mehtaab', names)).toBe('Ashamed, Raoult, Mehtaab');
    expect(scrubText('Verma-ji called', names)).toBe('[name]-ji called');
  });

  it('removes phones, emails and record numbers but keeps clinical numbers', () => {
    const scrub = createScrubber(names);
    expect(
      scrub(
        'Call +91 98765 43210, 9876543210, (022) 2345 6789 or 98765-43210; mail asha.v@example.com; MRN-000123, APT-2026-000045. Or +91-98765-43210.',
      ),
    ).toBe(
      'Call [removed], [removed], [removed] or [removed]; mail [removed]; [removed], [removed]. Or [removed].',
    );
    expect(scrub('BP 120/80, pulse 96, temp 38.6, Hb 14.2 12.0 11.5, 1-0-1 for 5 days')).toBe(
      'BP 120/80, pulse 96, temp 38.6, Hb 14.2 12.0 11.5, 1-0-1 for 5 days',
    );
    expect(scrub(null)).toBeNull();
    expect(scrub('  Asha  ')).toBe('[name]');
  });

  it('sends age in years and sex, never the date of birth', () => {
    expect(
      demographics({ dateOfBirth: new Date('1980-10-10'), gender: 'female' }, '2026-10-09'),
    ).toEqual({
      ageYears: 45,
      sex: 'female',
    });
    expect(demographics({}, '2026-10-09')).toEqual({ ageYears: null, sex: 'unknown' });
  });
});

describe('the AI provider payload', () => {
  let emails: ReturnType<typeof captureEmails>;
  beforeEach(async () => {
    await resetDb();
    await Promise.all([Appointment.init(), Encounter.init(), Prescription.init()]);
    await useMiddayClinicZone();
    resetMock();
    emails = captureEmails();
  });
  afterEach(() => emails.restore());

  it('carries no name, MRN, phone, email, address or date of birth of the patient or doctor', async () => {
    const doctor = await loginAs('doctor', {
      firstName: 'Zephyrine',
      lastName: 'Okonkwo',
      email: 'zephyrine.okonkwo@clinic.example',
    });
    await addDoctorProfile(doctor.user._id);
    const me = { ...doctor, id: doctor.user._id.toString() };
    const { id: patientId } = await createPatient({
      firstName: 'Bartholomew',
      lastName: 'Quillfeather',
      dateOfBirth: '1979-02-13',
      gender: 'male',
      phone: '+919812300456',
      email: 'bart.quill@mail.example',
      address: { line1: '42 Lilac Crescent', city: 'Pune', postalCode: '411001' },
      emergencyContact: { name: 'Marigold Quillfeather', phone: '+919812300457' },
      allergies: [{ substance: 'Penicillin', severity: 'severe' }],
    });
    const patient = await Patient.findById(patientId).lean();
    const mrn = patient!.mrn;
    const c = await readyToSign({
      doctor: me,
      patientId,
      note: {
        chiefComplaint: 'Bartholomew reports fever for 3 days',
        historyOfPresentIllness: `Mr QUILLFEATHER (${mrn}) called from 98123 00456; wife Marigold at bart.quill@mail.example`,
        examination: 'Throat congested. Seen with Dr Zephyrine Okonkwo, phone +91 98123 00457.',
        plan: 'Review with zephyrine.okonkwo@clinic.example',
      },
      items: [rxItem({ instructions: 'Bartholomew to take after food' })],
    });
    await signNote(c.doctor, c.encounterId);
    const res = await api()
      .post(`/api/v1/encounters/${c.encounterId}/summary/generate`)
      .set(me.auth);
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    expect(mockPayloads()).toHaveLength(1);
    const sent = JSON.stringify(lastPayload());
    for (const forbidden of [
      'Bartholomew',
      'Quillfeather',
      'Marigold',
      'Zephyrine',
      'Okonkwo',
      mrn,
      '+919812300456',
      '9812300456',
      '98123 00456',
      '98123 00457',
      formatPhone('+919812300456'),
      'bart.quill@mail.example',
      'zephyrine.okonkwo',
      '1979-02-13',
      '1979',
      'Lilac',
      '411001',
      patientId,
      c.encounterId,
    ]) {
      expect(sent.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
    // What is sent instead: age and sex, the placeholders and the clinical content.
    const user = lastPayload()!.user;
    expect(user).toMatch(/"ageYears": \d+/);
    expect(user).toContain('"sex": "male"');
    expect(user).toContain('[name] reports fever for 3 days');
    expect(user).toContain('[removed]');
    expect(user).toContain('Penicillin');
  });
});
