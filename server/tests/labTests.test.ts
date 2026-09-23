import { Types } from 'mongoose';
import { auditEntries, loginAs, resetDb, type LoggedIn } from './helpers/auth.js';
import { api, expectErrorShape } from './helpers/testApp.js';

let admin: LoggedIn;

const cbc = (overrides: object = {}) => ({
  code: 'cbc',
  name: 'Complete Blood Count',
  category: 'haematology',
  sampleType: 'blood',
  pricePaise: 35_000,
  turnaroundHours: 6,
  preparation: 'No fasting needed',
  parameters: [
    {
      key: 'hb',
      name: 'Haemoglobin',
      unit: 'g/dL',
      valueType: 'number',
      ranges: [
        { gender: 'male', ageMinYears: 18, low: 13, high: 17, criticalLow: 7, criticalHigh: 20 },
        {
          gender: 'female',
          ageMinYears: 18,
          low: 12,
          high: 15.5,
          criticalLow: 7,
          criticalHigh: 20,
        },
      ],
    },
    {
      key: 'wbc',
      name: 'Total WBC count',
      unit: '/µL',
      valueType: 'number',
      ranges: [{ low: 4000, high: 11000 }],
    },
  ],
  ...overrides,
});

const create = (body: object) => api().post('/api/v1/lab-tests').set(admin.auth).send(body);

describe('/lab-tests', () => {
  beforeEach(async () => {
    await resetDb();
    admin = await loginAs('admin');
  });

  describe('POST', () => {
    it('creates a test (code upper-cased, range gender defaults to any) and audits it', async () => {
      const res = await create(cbc());
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        code: 'CBC',
        pricePaise: 35_000,
        isActive: true,
        parameters: [
          { key: 'hb', ranges: [{ gender: 'male', low: 13 }, { gender: 'female' }] },
          { key: 'wbc', options: [], ranges: [{ gender: 'any', low: 4000, high: 11000 }] },
        ],
      });
      const [entry] = await auditEntries('lab_test.create');
      expect(entry).toMatchObject({ resource: { number: 'CBC' }, metadata: { parameters: 2 } });
    });

    it('409 for a duplicate code', async () => {
      await create(cbc());
      expectErrorShape((await create(cbc({ name: 'Other' }))).body, 'CONFLICT');
    });

    it.each([
      [{ parameters: [] }, 'body.parameters'],
      [{ pricePaise: 100.5 }, 'body.pricePaise'],
      [{ category: 'astrology' }, 'body.category'],
      [{ code: 'x' }, 'body.code'],
      [
        {
          parameters: [
            { key: 'hb', name: 'Hb', valueType: 'number' },
            { key: 'hb', name: 'Hb2', valueType: 'text' },
          ],
        },
        'body.parameters.1.key',
      ],
      [
        { parameters: [{ key: 'ns1', name: 'NS1', valueType: 'option' }] },
        'body.parameters.0.options',
      ],
      [
        {
          parameters: [
            { key: 'hb', name: 'Hb', valueType: 'number', ranges: [{ low: 17, high: 13 }] },
          ],
        },
        'body.parameters.0.ranges.0.high',
      ],
      [
        {
          parameters: [
            {
              key: 'hb',
              name: 'Hb',
              valueType: 'number',
              ranges: [
                { gender: 'female', ageMinYears: 12, low: 11, high: 15 },
                { gender: 'female', ageMinYears: 18, low: 12, high: 15.5 },
              ],
            },
          ],
        },
        'body.parameters.0.ranges.1',
      ],
      [{ parameters: [{ key: 'Hb!', name: 'Hb', valueType: 'number' }] }, 'body.parameters.0.key'],
      [{ parameters: 'lots' }, 'body.parameters'],
      [
        { parameters: [{ key: 'hb', name: 'Hb', valueType: 'number', ranges: 'normal' }] },
        'body.parameters.0.ranges',
      ],
    ])('400 for invalid input (%#)', async (override, field) => {
      const res = await create(cbc(override));
      const details = expectErrorShape(res.body, 'VALIDATION_ERROR').error.details as {
        field: string;
      }[];
      expect(details.map((d) => d.field)).toContain(field);
    });
  });

  describe('GET', () => {
    beforeEach(async () => {
      await create(cbc());
      await create({
        code: 'NS1',
        name: 'Dengue NS1 antigen',
        category: 'immunology',
        sampleType: 'blood',
        pricePaise: 60_000,
        parameters: [
          {
            key: 'ns1',
            name: 'NS1 antigen',
            valueType: 'option',
            options: ['Negative', 'Positive'],
          },
        ],
      });
      const old = await create(cbc({ code: 'OLD', name: 'Old test' }));
      await api().post(`/api/v1/lab-tests/${old.body.data.id}/deactivate`).set(admin.auth);
    });

    it('any logged-in user; patients see only name, price and preparation', async () => {
      const patient = await loginAs('patient');
      const res = await api().get('/api/v1/lab-tests').set(patient.auth);
      expect(res.body.data.map((t: { code: string }) => t.code)).toEqual(['CBC', 'NS1']);
      expect(Object.keys(res.body.data[0]).sort()).toEqual([
        'category',
        'code',
        'id',
        'name',
        'preparation',
        'pricePaise',
        'sampleType',
      ]);
      expect((await api().get('/api/v1/lab-tests')).status).toBe(401);
    });

    it('staff see parameters and ranges; admins also inactive tests', async () => {
      const lab = await loginAs('labtech');
      const res = await api().get('/api/v1/lab-tests?category=haematology').set(lab.auth);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].parameters[0].ranges[0]).toMatchObject({ criticalLow: 7 });
      expect(res.body.data[0]).not.toHaveProperty('isActive');

      const all = await api().get('/api/v1/lab-tests?includeInactive=true').set(admin.auth);
      expect(all.body.data).toHaveLength(3);
      const notAdmin = await api().get('/api/v1/lab-tests?includeInactive=true').set(lab.auth);
      expect(notAdmin.body.data).toHaveLength(2);
      const search = await api().get('/api/v1/lab-tests?q=dengue').set(lab.auth);
      expect(search.body.data.map((t: { code: string }) => t.code)).toEqual(['NS1']);
    });

    it('GET /lab-tests/:id: inactive → 404 except for admins', async () => {
      const all = await api().get('/api/v1/lab-tests?includeInactive=true').set(admin.auth);
      const old = all.body.data.find((t: { code: string }) => t.code === 'OLD');
      const doctor = await loginAs('doctor');
      expect((await api().get(`/api/v1/lab-tests/${old.id}`).set(doctor.auth)).status).toBe(404);
      expect((await api().get(`/api/v1/lab-tests/${old.id}`).set(admin.auth)).status).toBe(200);
      expect(
        (await api().get(`/api/v1/lab-tests/${new Types.ObjectId()}`).set(admin.auth)).status,
      ).toBe(404);
    });
  });

  describe('PATCH and status', () => {
    it('replaces parameters, audits the change, validates like create', async () => {
      const created = await create(cbc());
      const id = created.body.data.id as string;
      const res = await api()
        .patch(`/api/v1/lab-tests/${id}`)
        .set(admin.auth)
        .send({
          pricePaise: 40_000,
          parameters: [
            {
              key: 'hb',
              name: 'Haemoglobin',
              unit: 'g/dL',
              valueType: 'number',
              ranges: [{ low: 12, high: 17 }],
            },
          ],
        });
      expect(res.body.data.parameters).toHaveLength(1);
      expect(res.body.data.pricePaise).toBe(40_000);
      const [entry] = await auditEntries('lab_test.update');
      expect(entry?.changes).toMatchObject({
        fields: ['pricePaise', 'parameters'],
        before: { pricePaise: 35_000 },
        after: { pricePaise: 40_000 },
      });

      const bad = await api()
        .patch(`/api/v1/lab-tests/${id}`)
        .set(admin.auth)
        .send({ parameters: [] });
      expectErrorShape(bad.body, 'VALIDATION_ERROR');

      // No-op: no audit entry
      await api().patch(`/api/v1/lab-tests/${id}`).set(admin.auth).send({ pricePaise: 40_000 });
      expect(await auditEntries('lab_test.update')).toHaveLength(1);
    });

    it('deactivate / activate with transition errors', async () => {
      const created = await create(cbc());
      const url = `/api/v1/lab-tests/${created.body.data.id}`;
      expect((await api().post(`${url}/deactivate`).set(admin.auth)).body.data.isActive).toBe(
        false,
      );
      expectErrorShape(
        (await api().post(`${url}/deactivate`).set(admin.auth)).body,
        'INVALID_STATUS_TRANSITION',
      );
      expect((await api().post(`${url}/activate`).set(admin.auth)).body.data.isActive).toBe(true);
      expect(await auditEntries('lab_test.deactivate')).toHaveLength(1);
      expect(await auditEntries('lab_test.activate')).toHaveLength(1);
    });

    it('writes are admin-only', async () => {
      const lab = await loginAs('labtech');
      expect((await api().post('/api/v1/lab-tests').set(lab.auth).send(cbc())).status).toBe(403);
    });
  });
});
