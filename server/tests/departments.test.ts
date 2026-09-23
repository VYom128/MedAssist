import { Types } from 'mongoose';
import { Department } from '../src/modules/departments/model.js';
import { createDoctor } from './helpers/fixtures.js';
import { auditEntries, loginAs, resetDb, type LoggedIn } from './helpers/auth.js';
import { api, expectErrorShape } from './helpers/testApp.js';

let admin: LoggedIn;

const create = (body: object) => api().post('/api/v1/departments').set(admin.auth).send(body);

describe('/departments', () => {
  beforeEach(async () => {
    await resetDb();
    admin = await loginAs('admin');
  });

  describe('POST /departments', () => {
    it('creates a department (code upper-cased) and audits it', async () => {
      const res = await create({ name: 'General Medicine', code: 'gen', description: 'OPD' });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        name: 'General Medicine',
        code: 'GEN',
        description: 'OPD',
        isActive: true,
      });
      const [entry] = await auditEntries('department.create');
      expect(entry).toMatchObject({
        resource: { type: 'department', number: 'GEN' },
        actor: { role: 'admin' },
      });
    });

    it.each([
      [{ name: 'X', code: 'GEN' }, 'body.name'],
      [{ name: 'General', code: 'G' }, 'body.code'],
      [{ name: 'General', code: 'GENERALMEDI' }, 'body.code'],
      [{ name: 'General', code: 'GE1' }, 'body.code'],
      [{ name: 'General' }, 'body.code'],
      [{ name: 'General', code: 'GEN', isActive: false }, 'body'],
    ])('400 for %j', async (body, field) => {
      const res = await create(body);
      const details = expectErrorShape(res.body, 'VALIDATION_ERROR').error.details as {
        field: string;
      }[];
      expect(details.map((d) => d.field)).toContain(field);
    });

    it('409 for a duplicate name (any case) or code', async () => {
      await create({ name: 'Dermatology', code: 'DER' });
      const byName = await create({ name: 'dermatology', code: 'SKN' });
      expect(expectErrorShape(byName.body, 'CONFLICT').error.details).toEqual({ fields: ['name'] });
      const byCode = await create({ name: 'Skin', code: 'der' });
      expect(expectErrorShape(byCode.body, 'CONFLICT').error.details).toEqual({ fields: ['code'] });
    });
  });

  describe('GET /departments', () => {
    beforeEach(async () => {
      await create({ name: 'Paediatrics', code: 'PED' });
      await create({ name: 'ENT', code: 'ENT' });
      const old = await create({ name: 'Radiology', code: 'RAD' });
      await api().post(`/api/v1/departments/${old.body.data.id}/deactivate`).set(admin.auth);
    });

    it('is public: active only, public fields, sorted by name', async () => {
      const res = await api().get('/api/v1/departments');
      expect(res.status).toBe(200);
      expect(res.body.data.map((d: { code: string }) => d.code)).toEqual(['ENT', 'PED']);
      expect(Object.keys(res.body.data[0]).sort()).toEqual(['code', 'description', 'id', 'name']);
      expect(res.body.meta).toMatchObject({ total: 2 });
    });

    it('admins can include inactive departments; others cannot', async () => {
      const all = await api().get('/api/v1/departments?includeInactive=true').set(admin.auth);
      expect(all.body.data.map((d: { code: string }) => d.code)).toEqual(['ENT', 'PED', 'RAD']);
      expect(all.body.data[2]).toMatchObject({ isActive: false });

      const patient = await loginAs('patient');
      const res = await api().get('/api/v1/departments?includeInactive=true').set(patient.auth);
      expect(res.body.data).toHaveLength(2);
      const anon = await api().get('/api/v1/departments?includeInactive=true');
      expect(anon.body.data).toHaveLength(2);
    });

    it('401 for a bad token (not silently public)', async () => {
      const res = await api().get('/api/v1/departments').set({ Authorization: 'Bearer nope' });
      expect(res.status).toBe(401);
    });

    it('admins see the number of active doctors per department', async () => {
      const ped = await Department.findOne({ code: 'PED' }).lean();
      await createDoctor({}, { department: ped!._id });
      await createDoctor({}, { department: ped!._id });
      await createDoctor({ isActive: false }, { department: ped!._id });
      const res = await api().get('/api/v1/departments').set(admin.auth);
      expect(
        res.body.data.map((d: { code: string; activeDoctors: number }) => [
          d.code,
          d.activeDoctors,
        ]),
      ).toEqual([
        ['ENT', 0],
        ['PED', 2],
      ]);
      const one = await api().get(`/api/v1/departments/${ped!._id}`).set(admin.auth);
      expect(one.body.data.activeDoctors).toBe(2);
      expect((await api().get('/api/v1/departments')).body.data[0]).not.toHaveProperty(
        'activeDoctors',
      );
    });

    it('searches by name or code', async () => {
      const res = await api().get('/api/v1/departments?q=paed');
      expect(res.body.data.map((d: { code: string }) => d.code)).toEqual(['PED']);
    });

    it('GET /departments/:id: inactive ones are 404 except for admins', async () => {
      const rad = await Department.findOne({ code: 'RAD' }).lean();
      expect((await api().get(`/api/v1/departments/${rad!._id}`)).status).toBe(404);
      const asAdmin = await api().get(`/api/v1/departments/${rad!._id}`).set(admin.auth);
      expect(asAdmin.body.data).toMatchObject({ code: 'RAD', isActive: false });
      expect((await api().get(`/api/v1/departments/${new Types.ObjectId()}`)).status).toBe(404);
      expect((await api().get('/api/v1/departments/nope')).status).toBe(400);
    });
  });

  describe('PATCH /departments/:id', () => {
    it('updates, audits the diff, and rejects clashes', async () => {
      const gen = await create({ name: 'General Medicine', code: 'GEN' });
      await create({ name: 'ENT', code: 'ENT' });
      const id = gen.body.data.id as string;

      const res = await api()
        .patch(`/api/v1/departments/${id}`)
        .set(admin.auth)
        .send({ name: 'Internal Medicine', description: 'Adults' });
      expect(res.body.data).toMatchObject({ name: 'Internal Medicine', description: 'Adults' });
      const [entry] = await auditEntries('department.update');
      expect(entry?.changes).toMatchObject({
        fields: ['name', 'description'],
        before: { name: 'General Medicine' },
        after: { name: 'Internal Medicine' },
      });

      // Same name in a different case is not a clash with itself.
      const self = await api()
        .patch(`/api/v1/departments/${id}`)
        .set(admin.auth)
        .send({ name: 'internal medicine' });
      expect(self.status).toBe(200);

      const clash = await api()
        .patch(`/api/v1/departments/${id}`)
        .set(admin.auth)
        .send({ code: 'ent' });
      expectErrorShape(clash.body, 'CONFLICT');
    });
  });

  describe('deactivate / activate', () => {
    it('toggles status with audit entries; repeating is a 409 transition error', async () => {
      const gen = await create({ name: 'General Medicine', code: 'GEN' });
      const id = gen.body.data.id as string;

      const off = await api().post(`/api/v1/departments/${id}/deactivate`).set(admin.auth);
      expect(off.body.data.isActive).toBe(false);
      const again = await api().post(`/api/v1/departments/${id}/deactivate`).set(admin.auth);
      expectErrorShape(again.body, 'INVALID_STATUS_TRANSITION');

      const on = await api().post(`/api/v1/departments/${id}/activate`).set(admin.auth);
      expect(on.body.data.isActive).toBe(true);
      const onAgain = await api().post(`/api/v1/departments/${id}/activate`).set(admin.auth);
      expectErrorShape(onAgain.body, 'INVALID_STATUS_TRANSITION');

      expect(await auditEntries('department.deactivate')).toHaveLength(1);
      expect(await auditEntries('department.activate')).toHaveLength(1);
      expect(
        (await api().post(`/api/v1/departments/${new Types.ObjectId()}/activate`).set(admin.auth))
          .status,
      ).toBe(404);
    });
  });

  it('writes are admin-only', async () => {
    const reception = await loginAs('receptionist');
    const res = await api()
      .post('/api/v1/departments')
      .set(reception.auth)
      .send({ name: 'Dermatology', code: 'DER' });
    expect(res.status).toBe(403);
    expect(
      (await api().post('/api/v1/departments').send({ name: 'Dermatology', code: 'DER' })).status,
    ).toBe(401);
  });
});
