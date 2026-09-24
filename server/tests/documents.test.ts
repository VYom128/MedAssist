import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Types } from 'mongoose';
import { config } from '../src/config/env.js';
import { Document } from '../src/modules/documents/model.js';
import { notConfiguredStorage } from '../src/services/storage/index.js';
import { localStorage } from '../src/services/storage/local.js';
import { safeFileName } from '../src/utils/files.js';
import { auditEntries, loginAs, resetDb, type LoggedIn } from './helpers/auth.js';
import {
  createPatient,
  insertAppointment,
  insertLabOrder,
  loginAsDoctor,
  loginAsPatient,
} from './helpers/fixtures.js';
import { jpegBytes, pdfBytes, pngBytes } from './helpers/files.js';
import { api, expectErrorShape } from './helpers/testApp.js';

/**
 * Documents (spec §6.23, §7.16, §10.3): uploads checked on their bytes, categories per role,
 * patient access, scoped reads, audited downloads with safe headers, and soft delete.
 */

beforeEach(resetDb);

function expectError(res: { status: number; body: unknown }, status: number, code: string) {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return expectErrorShape(res.body, code);
}

interface UploadOptions {
  patientId: string;
  category: string;
  title?: string;
  file?: Buffer;
  name?: string;
  contentType?: string;
  extra?: Record<string, string>;
}

function upload(who: LoggedIn, o: UploadOptions) {
  let req = api()
    .post('/api/v1/documents')
    .set(who.auth)
    .field('patientId', o.patientId)
    .field('category', o.category)
    .field('title', o.title ?? 'A document');
  for (const [k, v] of Object.entries(o.extra ?? {})) req = req.field(k, v);
  if (o.file !== undefined) {
    req = req.attach('file', o.file, {
      filename: o.name ?? 'file.pdf',
      contentType: o.contentType ?? 'application/pdf',
    });
  }
  return req;
}

const get = (who: LoggedIn, p: string) => api().get(`/api/v1${p}`).set(who.auth);
const download = (who: LoggedIn, id: string) =>
  api()
    .get(`/api/v1/documents/${id}/download`)
    .set(who.auth)
    .buffer(true)
    .parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });

/** A doctor with a care relationship (an appointment) with a new patient. */
async function doctorWithPatient() {
  const doctor = await loginAsDoctor();
  const { id: patientId } = await createPatient();
  const appt = await insertAppointment({
    patient: patientId,
    doctor: doctor.id,
    startAt: new Date(Date.now() - 86_400_000),
    status: 'completed',
    isSlotActive: false,
  });
  return { doctor, patientId, appointmentId: appt._id.toString() };
}

describe('POST /documents – file checks', () => {
  it('stores a real PNG: type from the bytes, safe name, SHA-256, never the storage key', async () => {
    const reception = await loginAs('receptionist');
    const { id: patientId } = await createPatient();
    const bytes = pngBytes();
    const res = await upload(reception, {
      patientId,
      category: 'id_proof',
      title: 'Aadhaar card',
      file: bytes,
      name: '../../etc/aadhaar scan (1).PNG',
      contentType: 'application/octet-stream',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data).toMatchObject({
      patientId,
      category: 'id_proof',
      title: 'Aadhaar card',
      mimeType: 'image/png',
      originalName: 'aadhaar scan_1.png',
      sizeBytes: bytes.length,
      checksumSha256: createHash('sha256').update(bytes).digest('hex'),
      visibleToPatient: false,
      isGenerated: false,
      uploadedByRole: 'receptionist',
      canDelete: true,
    });
    const stored = await Document.findById(res.body.data.id).select('+storageKey').lean();
    expect(stored!.storageKey).toMatch(/^\d{4}\/\d{2}\/[0-9a-f-]{36}\.png$/);
    expect(JSON.stringify(res.body)).not.toContain(stored!.storageKey);
    expect(JSON.stringify(res.body)).not.toMatch(/storageKey/);
    const onDisk = await readFile(
      path.join(config.storage.uploadDir, ...stored!.storageKey.split('/')),
    );
    expect(onDisk.equals(bytes)).toBe(true);
    const [entry] = await auditEntries('document.upload');
    expect(entry).toMatchObject({ metadata: { category: 'id_proof', mimeType: 'image/png' } });
    expect(JSON.stringify(entry)).not.toMatch(/Aadhaar/);
  });

  it('415 for spoofed files (a .png that is text, an .exe called .pdf); nothing is stored', async () => {
    const reception = await loginAs('receptionist');
    const { id: patientId } = await createPatient();
    for (const [file, name, contentType] of [
      [Buffer.from('just some text, not an image'), 'scan.png', 'image/png'],
      [Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200, 1)]), 'report.pdf', 'application/pdf'],
      [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'x.png', 'image/png'],
    ] as const) {
      const res = await upload(reception, {
        patientId,
        category: 'id_proof',
        file,
        name,
        contentType,
      });
      expectError(res, 415, 'UNSUPPORTED_FILE_TYPE');
    }
    expect(await Document.countDocuments()).toBe(0);
    // JPEG and PDF are fine.
    expect(
      (
        await upload(reception, {
          patientId,
          category: 'insurance',
          file: jpegBytes(),
          name: 'card.jpg',
        })
      ).status,
    ).toBe(201);
    expect(
      (await upload(reception, { patientId, category: 'insurance', file: pdfBytes() })).status,
    ).toBe(201);
  });

  it('413 FILE_TOO_LARGE over MAX_UPLOAD_MB; 400 without a file or with bad fields', async () => {
    const reception = await loginAs('receptionist');
    const { id: patientId } = await createPatient();
    const big = Buffer.concat([pdfBytes(), Buffer.alloc(config.storage.maxUploadBytes, 32)]);
    expectError(
      await upload(reception, { patientId, category: 'id_proof', file: big }),
      413,
      'FILE_TOO_LARGE',
    );
    const none = await upload(reception, { patientId, category: 'id_proof' });
    expect(expectError(none, 400, 'VALIDATION_ERROR').error.details).toEqual([
      { field: 'file', message: 'Choose a file to upload' },
    ]);
    expectError(
      await upload(reception, { patientId, category: 'selfie', file: pdfBytes() }),
      400,
      'VALIDATION_ERROR',
    );
    expectError(
      await upload(reception, {
        patientId,
        category: 'id_proof',
        file: pdfBytes(),
        extra: { linkedType: 'appointment' },
      }),
      400,
      'VALIDATION_ERROR',
    );
    expect(await Document.countDocuments()).toBe(0);
  });
});

describe('POST /documents – who uploads what for whom', () => {
  it('categories per role: others → 403', async () => {
    const { doctor, patientId } = await doctorWithPatient();
    const reception = await loginAs('receptionist');
    const lab = await loginAs('labtech');
    const admin = await loginAs('admin');
    await insertLabOrder({ patient: patientId, doctor: doctor.id });
    const file = pdfBytes();
    const cases: [LoggedIn, string, number][] = [
      [doctor, 'referral', 201],
      [doctor, 'imaging', 201],
      [doctor, 'visit_summary', 201],
      [doctor, 'id_proof', 403],
      [doctor, 'lab_report', 403],
      [reception, 'id_proof', 201],
      [reception, 'insurance', 201],
      [reception, 'referral', 201],
      [reception, 'imaging', 403],
      [reception, 'lab_report', 403],
      [lab, 'lab_report', 201],
      [lab, 'other', 403],
      [admin, 'other', 403],
    ];
    for (const [who, category, status] of cases) {
      const res = await upload(who, { patientId, category, file });
      expect(res.status, `${who.user.role} ${category}`).toBe(status);
    }
  });

  it('doctors need a care relationship, lab techs a placed lab order (else 404, audited)', async () => {
    const { id: patientId } = await createPatient();
    const stranger = await loginAsDoctor();
    const lab = await loginAs('labtech');
    expectError(
      await upload(stranger, { patientId, category: 'referral', file: pdfBytes() }),
      404,
      'NOT_FOUND',
    );
    expectError(
      await upload(lab, { patientId, category: 'lab_report', file: pdfBytes() }),
      404,
      'NOT_FOUND',
    );
    await insertLabOrder({ patient: patientId, doctor: stranger.id, status: 'draft' });
    expectError(
      await upload(lab, { patientId, category: 'lab_report', file: pdfBytes() }),
      404,
      'NOT_FOUND',
    );
    expect(await auditEntries('access.denied')).toHaveLength(3);
  });

  it('patients upload only for themselves, only other/referral, always visible to them', async () => {
    const me = await loginAsPatient();
    const { id: someoneElse } = await createPatient();
    const own = await upload(me, {
      patientId: me.patientId,
      category: 'referral',
      file: pdfBytes(),
      extra: { visibleToPatient: 'false' },
    });
    expect(own.status).toBe(201);
    expect(own.body.data.visibleToPatient).toBe(true);
    expect(
      (await upload(me, { patientId: me.patientId, category: 'insurance', file: pdfBytes() }))
        .status,
    ).toBe(403);
    expectError(
      await upload(me, { patientId: someoneElse, category: 'other', file: pdfBytes() }),
      404,
      'NOT_FOUND',
    );
  });

  it('a linked record must belong to the same patient (422)', async () => {
    const { doctor, patientId, appointmentId } = await doctorWithPatient();
    const { id: other } = await createPatient();
    const otherAppt = await insertAppointment({
      patient: other,
      doctor: doctor.id,
      startAt: new Date(Date.now() - 2 * 86_400_000),
      status: 'completed',
      isSlotActive: false,
    });
    const link = (id: string) =>
      upload(doctor, {
        patientId,
        category: 'referral',
        file: pdfBytes(),
        extra: { linkedType: 'appointment', linkedId: id },
      });
    const ok = await link(appointmentId);
    expect(ok.status).toBe(201);
    expect(ok.body.data.linked).toEqual({ type: 'appointment', id: appointmentId });
    const wrong = await link(otherAppt._id.toString());
    expect(expectError(wrong, 422, 'BUSINESS_RULE_VIOLATION').error.details).toEqual([
      { field: 'body.linkedId', message: 'Not a record of this patient' },
    ]);
  });
});

describe('reading and downloading', () => {
  /** A patient with documents from reception, the patient, a doctor and the lab. */
  async function library() {
    const { doctor, patientId } = await doctorWithPatient();
    const reception = await loginAs('receptionist');
    const lab = await loginAs('labtech');
    const patient = await loginAs('patient', { patient: patientId, patientLinkStatus: 'linked' });
    patient.user.patient = patientId as never;
    await insertLabOrder({ patient: patientId, doctor: doctor.id });
    const up = async (who: LoggedIn, category: string, extra: Record<string, string> = {}) =>
      (
        await upload(who, {
          patientId,
          category,
          file: pdfBytes(category),
          title: `${category} doc`,
          extra,
        })
      ).body.data.id as string;
    const idProof = await up(reception, 'id_proof');
    const patientReferral = await up(patient, 'referral');
    const doctorReferral = await up(doctor, 'referral');
    const imaging = await up(doctor, 'imaging', { visibleToPatient: 'true' });
    const hidden = await up(doctor, 'other');
    const labReport = await up(lab, 'lab_report', { visibleToPatient: 'true' });
    return {
      doctor,
      reception,
      lab,
      patient,
      patientId,
      ids: { idProof, patientReferral, doctorReferral, imaging, hidden, labReport },
    };
  }

  it('download: the bytes with safe headers; audited every time', async () => {
    const l = await library();
    const res = await download(l.reception, l.ids.idProof);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toBe('attachment; filename="file.pdf"');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect((res.body as Buffer).equals(pdfBytes('id_proof'))).toBe(true);
    await download(l.reception, l.ids.idProof);
    const entries = await auditEntries('document.download');
    expect(entries).toHaveLength(2);
    expect(entries[0]!.patient!.toString()).toBe(l.patientId);
  });

  it('access matrix per role (denials 404; admins: metadata only)', async () => {
    const l = await library();
    const stranger = await loginAsDoctor();
    const admin = await loginAs('admin');
    const matrix: [LoggedIn, keyof typeof l.ids, number][] = [
      [l.doctor, 'idProof', 200],
      [l.doctor, 'labReport', 200],
      [l.doctor, 'hidden', 200],
      [stranger, 'idProof', 404],
      [l.reception, 'idProof', 200],
      [l.reception, 'patientReferral', 200],
      [l.reception, 'doctorReferral', 404],
      [l.reception, 'imaging', 404],
      [l.reception, 'labReport', 404],
      [l.lab, 'labReport', 200],
      [l.lab, 'idProof', 404],
      [l.patient, 'patientReferral', 200],
      [l.patient, 'imaging', 200],
      [l.patient, 'labReport', 200],
      [l.patient, 'hidden', 404],
      [l.patient, 'idProof', 404],
      [admin, 'idProof', 403],
    ];
    for (const [who, key, status] of matrix) {
      expect((await download(who, l.ids[key])).status, `${who.user.role} ${key}`).toBe(status);
      const meta = await get(who, `/documents/${l.ids[key]}`);
      expect(meta.status, `${who.user.role} ${key} metadata`).toBe(who === admin ? 200 : status);
    }
    const adminView = await get(admin, `/documents/${l.ids.imaging}`);
    expect(adminView.body.data).not.toHaveProperty('title');
    expect(adminView.body.data).not.toHaveProperty('originalName');
  });

  it('lists are scoped per role; storage keys never appear', async () => {
    const l = await library();
    const titles = async (who: LoggedIn, q = `?patient=${l.patientId}`) =>
      ((await get(who, `/documents${q}`)).body.data as { title?: string; category: string }[])
        .map((d) => d.title ?? d.category)
        .sort();
    expect(await titles(l.reception)).toEqual(['id_proof doc', 'referral doc']);
    expect(await titles(l.lab)).toEqual(['lab_report doc']);
    expect(await titles(l.lab, '')).toEqual(['lab_report doc']);
    expect(await titles(l.patient, '')).toEqual(['imaging doc', 'lab_report doc', 'referral doc']);
    expect(await titles(l.doctor)).toHaveLength(6);
    expect(await titles(l.doctor, '?category=referral')).toEqual(['referral doc', 'referral doc']);
    const stranger = await loginAsDoctor();
    expectError(await get(stranger, `/documents?patient=${l.patientId}`), 404, 'NOT_FOUND');
    expect((await get(stranger, '/documents')).body.data).toEqual([]);
    const keys = await Document.find().select('+storageKey').lean();
    const everything = JSON.stringify([
      (await get(l.doctor, `/documents?patient=${l.patientId}`)).body,
      (await get(l.doctor, `/documents/${l.ids.hidden}`)).body,
    ]);
    for (const k of keys) expect(everything).not.toContain(k.storageKey);
    expect(everything).not.toMatch(/storageKey|storageDriver/);
  });
});

describe('soft delete', () => {
  it('the uploader within 24 h, admins any time; generated documents never; hidden afterwards', async () => {
    const reception = await loginAs('receptionist');
    const other = await loginAs('receptionist');
    const admin = await loginAs('admin');
    const { id: patientId } = await createPatient();
    const up = async () =>
      (await upload(reception, { patientId, category: 'id_proof', file: pdfBytes() })).body.data
        .id as string;
    const del = (who: LoggedIn, id: string, reason = 'Uploaded to the wrong patient') =>
      api().post(`/api/v1/documents/${id}/delete`).set(who.auth).send({ reason });

    const mine = await up();
    expectError(await del(reception, mine, 'no'), 400, 'VALIDATION_ERROR');
    expectError(await del(other, mine), 404, 'NOT_FOUND');
    const ok = await del(reception, mine);
    expect(ok.status).toBe(200);
    expect(ok.body.data).toEqual({ id: mine, isDeleted: true });
    expectError(await get(reception, `/documents/${mine}`), 404, 'NOT_FOUND');
    expect((await download(reception, mine)).status).toBe(404);
    expect((await get(reception, `/documents?patient=${patientId}`)).body.data).toEqual([]);
    expectError(await del(reception, mine), 404, 'NOT_FOUND');
    const stored = await Document.findById(mine).lean();
    expect(stored).toMatchObject({
      isDeleted: true,
      deleteReason: 'Uploaded to the wrong patient',
    });

    const old = await up();
    await Document.collection.updateOne(
      { _id: new Types.ObjectId(old) },
      { $set: { createdAt: new Date(Date.now() - 25 * 3_600_000) } },
    );
    expectError(await del(reception, old), 403, 'FORBIDDEN');
    expect((await del(admin, old)).status).toBe(200);
    expect(await auditEntries('document.delete')).toHaveLength(2);

    const generated = await Document.create({
      patient: patientId,
      category: 'lab_report',
      title: 'Lab report',
      originalName: 'report.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 10,
      storageDriver: 'local',
      storageKey: '2026/09/00000000-0000-0000-0000-000000000000.pdf',
      checksumSha256: 'a'.repeat(64),
      isGenerated: true,
    });
    expectError(await del(admin, generated._id.toString()), 409, 'RECORD_LOCKED');
    await expect(Document.deleteOne({ _id: generated._id })).rejects.toMatchObject({
      code: 'RECORD_LOCKED',
    });
  });
});

describe('storage and names', () => {
  it('local storage refuses keys outside its layout; s3/cloudinary are not configured', async () => {
    const storage = localStorage(config.storage.uploadDir);
    await expect(storage.createReadStream('../../etc/passwd')).rejects.toMatchObject({
      statusCode: 404,
    });
    await expect(
      storage.createReadStream('2026/09/00000000-0000-0000-0000-000000000000.pdf'),
    ).rejects.toMatchObject({
      statusCode: 404,
    });
    for (const driver of ['s3', 'cloudinary'] as const) {
      await expect(
        notConfiguredStorage(driver).save(Buffer.from('x'), {
          mimeType: 'application/pdf',
          originalName: 'x',
        }),
      ).rejects.toThrow(`Storage driver "${driver}" is not configured`);
    }
  });

  it('safeFileName keeps the real extension and plain characters only', () => {
    expect(safeFileName('C:\\Users\\me\\Report Final.PDF', 'application/pdf')).toBe(
      'Report Final.pdf',
    );
    expect(safeFileName('photo.png.exe', 'image/jpeg')).toBe('photo.png.jpg');
    expect(safeFileName('rm -rf ;"$(x)".pdf', 'application/pdf')).toBe('rm -rf_x.pdf');
    expect(safeFileName('', 'image/png')).toBe('document.png');
    expect(safeFileName(`${'a'.repeat(300)}.pdf`, 'application/pdf')).toHaveLength(120);
  });
});
