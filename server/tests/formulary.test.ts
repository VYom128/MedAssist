import { DRUG_FORMS, DRUG_FREQUENCY_CODES, DRUG_ROUTES } from '../src/config/constants.js';
import { FORMULARY } from '../src/data/formulary.js';
import { searchFormulary } from '../src/modules/formulary/service.js';
import { loginAs, resetDb } from './helpers/auth.js';
import { api, expectErrorShape } from './helpers/testApp.js';

describe('formulary data', () => {
  it('has about 100 drugs with valid forms, routes and frequency hints', () => {
    expect(FORMULARY.length).toBeGreaterThanOrEqual(100);
    const names = new Set<string>();
    for (const d of FORMULARY) {
      expect(names.has(d.name.toLowerCase()), `duplicate ${d.name}`).toBe(false);
      names.add(d.name.toLowerCase());
      expect(d.genericName.length).toBeGreaterThan(0);
      expect(d.strengths.length).toBeGreaterThan(0);
      for (const f of d.forms) expect(DRUG_FORMS).toContain(f);
      expect(DRUG_ROUTES).toContain(d.route);
      if (d.frequencyHint) expect(DRUG_FREQUENCY_CODES).toContain(d.frequencyHint);
    }
  });
});

describe('searchFormulary', () => {
  it('prefix-matches the name or generic name, case-insensitively, name matches first', () => {
    // 'Paracetamol' by name first, then generic matches (brands, and Paradichlorobenzene).
    expect(searchFormulary('PARA', 10).map((d) => d.name)).toEqual([
      'Paracetamol',
      'Crocin',
      'Dolo 650',
      'Wax softening drops',
    ]);
    const amox = searchFormulary('amoxi', 10).map((d) => d.name);
    expect(amox[0]).toBe('Amoxicillin');
    expect(amox).toEqual(expect.arrayContaining(['Co-amoxiclav', 'Augmentin']));
    // Brand names point at their generic.
    expect(searchFormulary('dolo', 10)[0]).toMatchObject({ genericName: 'Paracetamol' });
    expect(searchFormulary('paracetamol', 10).map((d) => d.name)).toEqual(
      expect.arrayContaining(['Paracetamol', 'Dolo 650', 'Crocin']),
    );
  });

  it('does not match inside words, respects the limit, and treats input as plain text', () => {
    expect(searchFormulary('cillin', 10)).toEqual([]);
    expect(searchFormulary('a', 3)).toHaveLength(3);
    expect(searchFormulary('.*', 10)).toEqual([]);
    expect(searchFormulary('(', 10)).toEqual([]);
    expect(searchFormulary('   ', 10)).toEqual([]);
  });
});

describe('GET /formulary', () => {
  beforeAll(resetDb);

  it('doctors get suggestions with labelled frequency hints', async () => {
    const doctor = await loginAs('doctor');
    const res = await api().get('/api/v1/formulary?q=metf').set(doctor.auth);
    expect(res.status).toBe(200);
    expect(res.body.data[0]).toEqual({
      name: 'Metformin',
      genericName: 'Metformin',
      strengths: ['500 mg', '850 mg', '1000 mg'],
      forms: ['tablet'],
      route: 'oral',
      doseHint: '1 tablet',
      frequencyHint: 'BD',
      frequencyHintLabel: 'Twice a day',
    });
    const limited = await api().get('/api/v1/formulary?q=c&limit=2').set(doctor.auth);
    expect(limited.body.data).toHaveLength(2);
  });

  it('q is required; limit at most 25', async () => {
    const doctor = await loginAs('doctor');
    expectErrorShape(
      (await api().get('/api/v1/formulary').set(doctor.auth)).body,
      'VALIDATION_ERROR',
    );
    expectErrorShape(
      (await api().get('/api/v1/formulary?q=a&limit=100').set(doctor.auth)).body,
      'VALIDATION_ERROR',
    );
  });

  it('other roles → 403', async () => {
    for (const role of ['admin', 'receptionist', 'labtech', 'patient'] as const) {
      const who = await loginAs(role);
      expect((await api().get('/api/v1/formulary?q=para').set(who.auth)).status).toBe(403);
    }
  });
});
