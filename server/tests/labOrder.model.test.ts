import {
  LabOrder,
  allowRevisionSave,
  revisionWriteOptions,
} from '../src/modules/labOrders/model.js';
import { resetDb } from './helpers/auth.js';
import { createLabTest, createPatient, insertLabOrder, loginAsDoctor } from './helpers/fixtures.js';

/**
 * Lab order immutability at the model level (spec §10.5): orders are never deleted; the items
 * (results) of a released order change only through the revision path.
 */

async function order(status: string) {
  const doctor = await loginAsDoctor();
  const { id: patient } = await createPatient();
  const test = await createLabTest();
  return insertLabOrder({ patient, doctor: doctor.id, status, tests: [test] });
}

beforeEach(async () => {
  await resetDb();
  await LabOrder.init();
});

describe('released results', () => {
  it('refuses query updates touching items without the revision token', async () => {
    const o = await order('released');
    const attempts = [
      () => LabOrder.updateOne({ _id: o._id }, { $set: { 'items.0.remarks': 'changed' } }),
      () => LabOrder.findOneAndUpdate({ _id: o._id }, { $set: { items: [] } }),
      () =>
        LabOrder.updateMany({}, { $push: { 'items.0.results': { parameterKey: 'x', name: 'x' } } }),
      () => LabOrder.replaceOne({ _id: o._id }, { ...o.toObject(), items: [] }),
    ];
    for (const attempt of attempts) {
      await expect(attempt()).rejects.toMatchObject({ statusCode: 409, code: 'RECORD_LOCKED' });
    }
    expect((await LabOrder.findById(o._id).lean())!.items).toHaveLength(1);
  });

  it('allows status bookkeeping on released orders, and items changes with the token', async () => {
    const o = await order('released');
    await LabOrder.updateOne({ _id: o._id }, { $set: { reviewedByDoctorAt: new Date() } });
    await LabOrder.updateOne(
      { _id: o._id },
      { $set: { 'items.0.remarks': 'revised' } },
      revisionWriteOptions(),
    );
    const stored = await LabOrder.findById(o._id).lean();
    expect(stored!.reviewedByDoctorAt).toBeInstanceOf(Date);
    expect(stored!.items[0]!.remarks).toBe('revised');
  });

  it('save() of a loaded released order refuses item changes unless marked by the revision path', async () => {
    const o = await order('released');
    const doc = (await LabOrder.findById(o._id))!;
    doc.items[0]!.remarks = 'changed';
    await expect(doc.save()).rejects.toMatchObject({ code: 'RECORD_LOCKED' });
    const again = (await LabOrder.findById(o._id))!;
    again.items[0]!.remarks = 'revised';
    allowRevisionSave(again);
    await again.save();
    expect((await LabOrder.findById(o._id).lean())!.items[0]!.remarks).toBe('revised');
  });

  it('unreleased orders take item updates normally', async () => {
    const o = await order('processing');
    await LabOrder.updateOne({ _id: o._id }, { $set: { 'items.0.remarks': 'in progress' } });
    expect((await LabOrder.findById(o._id).lean())!.items[0]!.remarks).toBe('in progress');
  });
});

describe('never deleted', () => {
  it('refuses deletes and bulk writes', async () => {
    const o = await order('ordered');
    await expect(LabOrder.deleteOne({ _id: o._id })).rejects.toMatchObject({
      code: 'RECORD_LOCKED',
    });
    await expect(LabOrder.deleteMany({})).rejects.toMatchObject({ code: 'RECORD_LOCKED' });
    await expect(LabOrder.findOneAndDelete({ _id: o._id })).rejects.toMatchObject({
      code: 'RECORD_LOCKED',
    });
    await expect(o.deleteOne()).rejects.toMatchObject({ code: 'RECORD_LOCKED' });
    await expect(
      LabOrder.bulkWrite([{ deleteOne: { filter: { _id: o._id } } }]),
    ).rejects.toMatchObject({ code: 'RECORD_LOCKED' });
    expect(await LabOrder.countDocuments()).toBe(1);
  });

  it('sample ids and order numbers are unique', async () => {
    const a = await order('sample_collected');
    const b = await order('sample_collected');
    await LabOrder.updateOne({ _id: a._id }, { $set: { 'sample.sampleId': 'S26-000001' } });
    await expect(
      LabOrder.updateOne({ _id: b._id }, { $set: { 'sample.sampleId': 'S26-000001' } }),
    ).rejects.toMatchObject({ code: 11000 });
    await expect(
      LabOrder.updateOne({ _id: b._id }, { $set: { orderNumber: a.orderNumber } }),
    ).rejects.toMatchObject({ code: 11000 });
  });
});
