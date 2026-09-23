import { Patient } from '../src/modules/patients/model.js';
import { addDaysToDate, clinicToday, subtractYears } from '../src/utils/dates.js';
import { loginAs, resetDb, type LoggedIn } from './helpers/auth.js';
import { createPatient } from './helpers/fixtures.js';
import { api, expectErrorShape } from './helpers/testApp.js';

const today = () => clinicToday('Asia/Kolkata');
/** Date of birth of someone who is exactly `years` old today (birthday today). */
const bornYearsAgo = (years: number, plusDays = 0) =>
  addDaysToDate(subtractYears(today(), years), plusDays);

describe('GET /patients (search and filters)', () => {
  let reception: LoggedIn;
  let admin: LoggedIn;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    await resetDb();
    reception = await loginAs('receptionist');
    admin = await loginAs('admin');
    const make = async (key: string, o: Record<string, unknown> & { dateOfBirth?: string }) => {
      ids[key] = (await createPatient(o)).id;
    };
    await make('priya', {
      firstName: 'Priya',
      lastName: 'Sharma',
      phone: '+919876543210',
      gender: 'female',
      dateOfBirth: bornYearsAgo(30),
    });
    await make('priyanka', {
      firstName: 'Priyanka',
      lastName: 'Verma',
      gender: 'female',
      dateOfBirth: bornYearsAgo(30, 1), // turns 30 tomorrow → 29
    });
    await make('rahul', {
      firstName: 'Rahul',
      lastName: 'Sharma',
      gender: 'male',
      dateOfBirth: bornYearsAgo(5),
    });
    await make('anil', {
      firstName: 'Anil',
      lastName: 'Kumar Rao',
      gender: 'male',
      dateOfBirth: bornYearsAgo(70),
    });
    await make('old', { firstName: 'Old', lastName: 'Record', isActive: false });
    // The portal filter only needs `user` to be set.
    await Patient.updateOne({ _id: ids.anil }, { $set: { user: admin.user._id } });
  });

  const list = (query: Record<string, unknown>, me: LoggedIn = reception) =>
    api().get('/api/v1/patients').query(query).set(me.auth);
  const idsOf = (res: { body: { data: { id: string }[] } }) =>
    res.body.data.map((p) => p.id).sort();
  const expectIds = (res: { body: { data: { id: string }[] } }, keys: string[]) =>
    expect(idsOf(res)).toEqual(keys.map((k) => ids[k]).sort());

  it('lists active patients as list items, newest first, with pagination meta', async () => {
    const res = await list({});
    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ page: 1, limit: 20, total: 4, totalPages: 1 });
    expect(res.body.data[0]).toEqual({
      id: ids.anil,
      mrn: expect.stringMatching(/^MRN-\d{6}$/),
      firstName: 'Anil',
      lastName: 'Kumar Rao',
      fullName: 'Anil Kumar Rao',
      age: 70,
      gender: 'male',
      isActive: true,
      phone: expect.stringMatching(/^\+91/),
      hasPortal: true,
    });
    expectIds(res, ['priya', 'priyanka', 'rahul', 'anil']);
  });

  it('hides deactivated patients by default; admins can filter by isActive', async () => {
    expect(idsOf(await list({ isActive: 'false' }))).not.toContain(ids.old); // receptionist: ignored
    expectIds(await list({ isActive: 'false' }, admin), ['old']);
    expect((await list({}, admin)).body.meta.total).toBe(4);
  });

  it('finds by MRN (exact)', async () => {
    const mrn = (await Patient.findById(ids.rahul).lean())!.mrn;
    expectIds(await list({ q: mrn }), ['rahul']);
    expectIds(await list({ q: mrn.toLowerCase().replace('-', ' ') }), ['rahul']);
  });

  it.each(['+91 98765 43210', '09876543210', '9876543210', '98765-43210'])(
    'finds by phone in any format: %s',
    async (q) => {
      expectIds(await list({ q }), ['priya']);
    },
  );

  it('finds by name prefixes, case-insensitive, first or last name', async () => {
    expectIds(await list({ q: 'pri' }), ['priya', 'priyanka']);
    expectIds(await list({ q: 'SHAR' }), ['priya', 'rahul']);
    expectIds(await list({ q: 'priya' }), ['priya', 'priyanka']);
    expectIds(await list({ q: 'arma' }), []); // no infix matches
  });

  it('two-word queries need every word to match', async () => {
    expectIds(await list({ q: 'priya sharma' }), ['priya']);
    expectIds(await list({ q: 'sha rah' }), ['rahul']);
    expectIds(await list({ q: 'anil kumar' }), ['anil']);
    // Prefixes of the whole first or last name only: "rao" is not a prefix of "Kumar Rao".
    expectIds(await list({ q: 'kumar rao' }), []);
  });

  it('filters by gender and age (whole years in the clinic timezone)', async () => {
    expectIds(await list({ gender: 'male' }), ['rahul', 'anil']);
    expectIds(await list({ ageMin: 30 }), ['priya', 'anil']);
    expectIds(await list({ ageMax: 29 }), ['priyanka', 'rahul']);
    expectIds(await list({ ageMin: 29, ageMax: 30 }), ['priya', 'priyanka']);
    expectIds(await list({ ageMin: 0, ageMax: 5 }), ['rahul']);
    const bad = await list({ ageMin: 40, ageMax: 20 });
    expectErrorShape(bad.body, 'VALIDATION_ERROR');
  });

  it('filters by registration date and portal account', async () => {
    expect((await list({ registeredFrom: today(), registeredTo: today() })).body.meta.total).toBe(
      4,
    );
    const tomorrow = addDaysToDate(today(), 1);
    expect((await list({ registeredFrom: tomorrow })).body.meta.total).toBe(0);
    expectIds(await list({ hasPortal: 'true' }), ['anil']);
    expectIds(await list({ hasPortal: 'false' }), ['priya', 'priyanka', 'rahul']);
  });

  it('sorts by whitelisted fields only', async () => {
    const byName = await list({ sort: 'lastName' });
    expect(byName.body.data.map((p: { lastName: string }) => p.lastName)).toEqual([
      'Kumar Rao',
      'Sharma',
      'Sharma',
      'Verma',
    ]);
    const byMrn = await list({ sort: '-mrn' });
    expect(byMrn.body.data[0].id).toBe(ids.anil);
    expectErrorShape((await list({ sort: 'phone' })).body, 'VALIDATION_ERROR');
  });

  it('paginates', async () => {
    const res = await list({ limit: 3, page: 2, sort: 'mrn' });
    expect(res.body.meta).toEqual({ page: 2, limit: 3, total: 4, totalPages: 2 });
    expect(res.body.data).toHaveLength(1);
  });

  it('doctors get an empty list until care relationships exist (Phase 5)', async () => {
    const doctor = await loginAs('doctor');
    const res = await list({}, doctor);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ data: [], meta: { total: 0 } });
  });

  it('patients and lab technicians cannot list patients (403)', async () => {
    for (const role of ['patient', 'labtech'] as const) {
      expect((await list({}, await loginAs(role))).status).toBe(403);
    }
  });
});
