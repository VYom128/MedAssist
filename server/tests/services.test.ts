import { Types } from 'mongoose';
import { Department } from '../src/modules/departments/model.js';
import { auditEntries, loginAs, resetDb, type LoggedIn } from './helpers/auth.js';
import { api, expectErrorShape } from './helpers/testApp.js';

let admin: LoggedIn;
let gen: string;
let ped: string;

const create = (body: object) => api().post('/api/v1/services').set(admin.auth).send(body);
const consult = (overrides: object = {}) => ({
  code: 'CONS-GEN',
  name: 'General consultation',
  department: gen,
  type: 'consultation',
  durationMinutes: 15,
  pricePaise: 50_000,
  ...overrides,
});

describe('/services', () => {
  beforeEach(async () => {
    await resetDb();
    admin = await loginAs('admin');
    gen = (await Department.create({ name: 'General Medicine', code: 'GEN' }))._id.toString();
    ped = (await Department.create({ name: 'Paediatrics', code: 'PED' }))._id.toString();
  });

  describe('POST /services', () => {
    it('creates a service with the department populated and audits it', async () => {
      const res = await create(consult({ code: 'cons-gen', taxRateBps: 1800 }));
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        code: 'CONS-GEN',
        department: { id: gen, name: 'General Medicine', code: 'GEN' },
        type: 'consultation',
        durationMinutes: 15,
        pricePaise: 50_000,
        taxRateBps: 1800,
        isActive: true,
      });
      const [entry] = await auditEntries('service.create');
      expect(entry).toMatchObject({
        resource: { type: 'service', number: 'CONS-GEN' },
        metadata: { pricePaise: 50_000 },
      });
    });

    it('allows a clinic-wide service without a department; duration defaults to 15', async () => {
      const res = await create({
        code: 'DRESS',
        name: 'Dressing',
        type: 'procedure',
        pricePaise: 20_000,
      });
      expect(res.body.data).toMatchObject({
        department: null,
        durationMinutes: 15,
        taxRateBps: null,
      });
    });

    it.each([
      [{ pricePaise: 499.5 }, 'body.pricePaise'],
      [{ pricePaise: -1 }, 'body.pricePaise'],
      [{ pricePaise: '500' }, 'body.pricePaise'],
      [{ durationMinutes: 4 }, 'body.durationMinutes'],
      [{ durationMinutes: 241 }, 'body.durationMinutes'],
      [{ taxRateBps: 10_001 }, 'body.taxRateBps'],
      [{ taxRateBps: 12.5 }, 'body.taxRateBps'],
      [{ type: 'surgery' }, 'body.type'],
      [{ code: 'x' }, 'body.code'],
      [{ department: 'nope' }, 'body.department'],
    ])('400 for %j', async (override, field) => {
      const res = await create(consult(override));
      const details = expectErrorShape(res.body, 'VALIDATION_ERROR').error.details as {
        field: string;
      }[];
      expect(details.map((d) => d.field)).toContain(field);
    });

    it('409 for a duplicate code', async () => {
      await create(consult());
      const res = await create(consult({ name: 'Other' }));
      expect(expectErrorShape(res.body, 'CONFLICT').error.details).toEqual({ fields: ['code'] });
    });

    it('422 when the department is missing or inactive', async () => {
      const missing = await create(consult({ department: new Types.ObjectId().toString() }));
      expect(expectErrorShape(missing.body, 'BUSINESS_RULE_VIOLATION').error.details).toEqual([
        { field: 'body.department', message: 'Department not found' },
      ]);
      await Department.updateOne({ _id: ped }, { isActive: false });
      const inactive = await create(consult({ department: ped }));
      expect(inactive.status).toBe(422);
    });
  });

  describe('GET /services', () => {
    beforeEach(async () => {
      await create(consult());
      await create(consult({ code: 'CONS-PED', name: 'Paediatric consultation', department: ped }));
      await create({ code: 'NEB', name: 'Nebulisation', type: 'procedure', pricePaise: 30_000 });
      const old = await create(consult({ code: 'OLD', name: 'Old service' }));
      await api().post(`/api/v1/services/${old.body.data.id}/deactivate`).set(admin.auth);
    });

    it('is public: active services, public fields', async () => {
      const res = await api().get('/api/v1/services');
      expect(res.status).toBe(200);
      expect(res.body.data.map((s: { code: string }) => s.code)).toEqual([
        'CONS-GEN',
        'CONS-PED',
        'NEB',
      ]);
      expect(res.body.data[0]).not.toHaveProperty('isActive');
    });

    it('filters by department and type', async () => {
      const byDept = await api().get(`/api/v1/services?department=${ped}`);
      expect(byDept.body.data.map((s: { code: string }) => s.code)).toEqual(['CONS-PED']);
      const byType = await api().get('/api/v1/services?type=procedure');
      expect(byType.body.data.map((s: { code: string }) => s.code)).toEqual(['NEB']);
      expect((await api().get('/api/v1/services?type=surgery')).status).toBe(400);
    });

    it('hides services of an inactive department from everyone but admins', async () => {
      await Department.updateOne({ _id: ped }, { isActive: false });
      const pub = await api().get('/api/v1/services');
      expect(pub.body.data.map((s: { code: string }) => s.code)).toEqual(['CONS-GEN', 'NEB']);
      const byDept = await api().get(`/api/v1/services?department=${ped}`);
      expect(byDept.body.data).toEqual([]);

      const all = await api().get('/api/v1/services?includeInactive=true').set(admin.auth);
      expect(all.body.data).toHaveLength(4);
      const doctor = await loginAs('doctor');
      const notAdmin = await api().get('/api/v1/services?includeInactive=true').set(doctor.auth);
      expect(notAdmin.body.data).toHaveLength(2);
    });

    it('admins can filter by status', async () => {
      const codes = async (qs: string, auth = admin.auth) =>
        (await api().get(`/api/v1/services?${qs}`).set(auth)).body.data.map(
          (s: { code: string }) => s.code,
        );
      expect(await codes('isActive=false')).toEqual(['OLD']);
      expect(await codes('isActive=true')).toEqual(['CONS-GEN', 'CONS-PED', 'NEB']);
      const doctor = await loginAs('doctor');
      expect(await codes('isActive=false', doctor.auth)).toEqual(['CONS-GEN', 'CONS-PED', 'NEB']);
    });

    it('GET /services/:id hides inactive services from non-admins', async () => {
      const all = await api().get('/api/v1/services?includeInactive=true').set(admin.auth);
      const old = all.body.data.find((s: { code: string }) => s.code === 'OLD');
      expect((await api().get(`/api/v1/services/${old.id}`)).status).toBe(404);
      expect(
        (await api().get(`/api/v1/services/${old.id}`).set(admin.auth)).body.data,
      ).toMatchObject({
        code: 'OLD',
        isActive: false,
      });
    });
  });

  describe('PATCH /services/:id', () => {
    it('audits price changes with before and after', async () => {
      const created = await create(consult());
      const id = created.body.data.id as string;
      const res = await api()
        .patch(`/api/v1/services/${id}`)
        .set(admin.auth)
        .send({ pricePaise: 60_000, department: ped });
      expect(res.body.data).toMatchObject({ pricePaise: 60_000, department: { code: 'PED' } });

      const [entry] = await auditEntries('service.update');
      expect(entry?.changes).toMatchObject({
        fields: ['department', 'pricePaise'],
        before: { pricePaise: 50_000, department: gen },
        after: { pricePaise: 60_000, department: ped },
      });
    });

    it('no-op updates write no audit entry; code clash is 409', async () => {
      const created = await create(consult());
      await create(consult({ code: 'CONS-2', name: 'Second' }));
      const id = created.body.data.id as string;
      await api().patch(`/api/v1/services/${id}`).set(admin.auth).send({ pricePaise: 50_000 });
      expect(await auditEntries('service.update')).toHaveLength(0);
      const clash = await api()
        .patch(`/api/v1/services/${id}`)
        .set(admin.auth)
        .send({ code: 'cons-2' });
      expectErrorShape(clash.body, 'CONFLICT');
    });

    it('can clear the tax override and the department', async () => {
      const created = await create(consult({ taxRateBps: 500 }));
      const res = await api()
        .patch(`/api/v1/services/${created.body.data.id}`)
        .set(admin.auth)
        .send({ taxRateBps: null, department: null });
      expect(res.body.data).toMatchObject({ taxRateBps: null, department: null });
    });
  });

  describe('deactivate / activate', () => {
    it('toggles status; activating needs an active department', async () => {
      const created = await create(consult({ department: ped }));
      const id = created.body.data.id as string;
      await api().post(`/api/v1/services/${id}/deactivate`).set(admin.auth);
      expectErrorShape(
        (await api().post(`/api/v1/services/${id}/deactivate`).set(admin.auth)).body,
        'INVALID_STATUS_TRANSITION',
      );

      await Department.updateOne({ _id: ped }, { isActive: false });
      const blocked = await api().post(`/api/v1/services/${id}/activate`).set(admin.auth);
      expectErrorShape(blocked.body, 'BUSINESS_RULE_VIOLATION');

      await Department.updateOne({ _id: ped }, { isActive: true });
      const on = await api().post(`/api/v1/services/${id}/activate`).set(admin.auth);
      expect(on.body.data.isActive).toBe(true);
      expect(await auditEntries('service.deactivate')).toHaveLength(1);
      expect(await auditEntries('service.activate')).toHaveLength(1);
    });
  });
});
