import { Types } from 'mongoose';
import { amendmentWriteOptions, Encounter } from '../src/modules/encounters/model.js';
import { computeBmi } from '../src/modules/encounters/vitals.js';
import { resetDb } from './helpers/auth.js';

/**
 * Encounter immutability (spec §6.13, §10.5): a signed or amended note cannot be changed through
 * Mongoose except by the amendment path, and no note can be deleted.
 */

let n = 0;
async function note(status: 'draft' | 'signed' | 'amended' = 'draft') {
  n += 1;
  const e = await Encounter.create({
    encounterNumber: `ENC-2026-${String(n).padStart(6, '0')}`,
    appointment: new Types.ObjectId(),
    patient: new Types.ObjectId(),
    doctor: new Types.ObjectId(),
    visitAt: new Date(),
    chiefComplaint: 'Original',
  });
  if (status !== 'draft') {
    await Encounter.collection.updateOne({ _id: e._id }, { $set: { status } });
  }
  return e._id;
}

const LOCKED = { statusCode: 409, code: 'RECORD_LOCKED' };

describe('Encounter model – signed notes are locked', () => {
  beforeEach(resetDb);

  for (const status of ['signed', 'amended'] as const) {
    it(`every update path of a ${status} note throws RECORD_LOCKED`, async () => {
      const id = await note(status);
      const change = { $set: { chiefComplaint: 'Tampered' } };
      await expect(Encounter.updateOne({ _id: id }, change)).rejects.toMatchObject(LOCKED);
      await expect(Encounter.updateMany({}, change)).rejects.toMatchObject(LOCKED);
      await expect(Encounter.findOneAndUpdate({ _id: id }, change)).rejects.toMatchObject(LOCKED);
      await expect(Encounter.findByIdAndUpdate(id, change)).rejects.toMatchObject(LOCKED);
      await expect(
        Encounter.replaceOne({ _id: id }, { chiefComplaint: 'Tampered' }),
      ).rejects.toMatchObject(LOCKED);
      await expect(
        Encounter.findOneAndReplace({ _id: id }, { chiefComplaint: 'Tampered' }),
      ).rejects.toMatchObject(LOCKED);

      const doc = (await Encounter.findById(id))!;
      doc.chiefComplaint = 'Tampered';
      await expect(doc.save()).rejects.toMatchObject(LOCKED);
      await expect(doc.updateOne(change)).rejects.toMatchObject(LOCKED);
      await expect(
        Encounter.bulkWrite([{ updateOne: { filter: { _id: id }, update: change } }]),
      ).rejects.toMatchObject(LOCKED);

      expect((await Encounter.findById(id).lean())?.chiefComplaint).toBe('Original');
    });
  }

  it('a status change away from draft cannot be undone through Mongoose', async () => {
    const id = await note('signed');
    await expect(
      Encounter.updateOne({ _id: id }, { $set: { status: 'draft' } }),
    ).rejects.toMatchObject(LOCKED);
  });

  it('an update matching drafts and signed notes is refused as a whole', async () => {
    const draft = await note('draft');
    await note('signed');
    await expect(Encounter.updateMany({}, { $set: { plan: 'Bulk' } })).rejects.toMatchObject(
      LOCKED,
    );
    expect((await Encounter.findById(draft).lean())?.plan).toBeUndefined();
  });

  it('drafts can be updated (also by document save)', async () => {
    const id = await note('draft');
    await Encounter.updateOne({ _id: id }, { $set: { plan: 'Rest' } });
    const doc = (await Encounter.findById(id))!;
    doc.assessment = 'Viral';
    await doc.save();
    expect(await Encounter.findById(id).lean()).toMatchObject({
      plan: 'Rest',
      assessment: 'Viral',
    });
  });

  it('the amendment path (internal option) may update a signed note', async () => {
    const id = await note('signed');
    await Encounter.updateOne(
      { _id: id },
      { $set: { chiefComplaint: 'Amended', status: 'amended' }, $inc: { version: 1 } },
      amendmentWriteOptions(),
    );
    expect(await Encounter.findById(id).lean()).toMatchObject({
      chiefComplaint: 'Amended',
      status: 'amended',
      version: 2,
    });
    // A made-up token does not work.
    await expect(
      Encounter.updateOne({ _id: id }, { $set: { chiefComplaint: 'Forged' } }, {
        encounterAmendment: 'guess',
      } as never),
    ).rejects.toMatchObject(LOCKED);
  });

  it('no note can be deleted, draft or signed', async () => {
    const draft = await note('draft');
    const signed = await note('signed');
    for (const id of [draft, signed]) {
      await expect(Encounter.deleteOne({ _id: id })).rejects.toMatchObject(LOCKED);
      await expect(Encounter.findOneAndDelete({ _id: id })).rejects.toMatchObject(LOCKED);
      await expect(Encounter.findByIdAndDelete(id)).rejects.toMatchObject(LOCKED);
      await expect((await Encounter.findById(id))!.deleteOne()).rejects.toMatchObject(LOCKED);
    }
    await expect(Encounter.deleteMany({})).rejects.toMatchObject(LOCKED);
    expect(await Encounter.countDocuments()).toBe(2);
  });

  it('validates vitals ranges (§6.13) and computes BMI on save', async () => {
    const id = await note('draft');
    const doc = (await Encounter.findById(id))!;
    doc.set('vitals.pulse', 300);
    await expect(doc.save()).rejects.toMatchObject({ name: 'ValidationError' });
    doc.set('vitals.pulse', 80);
    doc.set('vitals.weightKg', 82);
    doc.set('vitals.heightCm', 180);
    await doc.save();
    expect((await Encounter.findById(id).lean())?.vitals?.bmi).toBe(25.3);
  });
});

describe('computeBmi', () => {
  it('weight / (height m)², 1 decimal; null without both', () => {
    expect(computeBmi(70, 175)).toBe(22.9);
    expect(computeBmi(3.5, 50)).toBe(14);
    expect(computeBmi(120, 160)).toBe(46.9);
    expect(computeBmi(70, null)).toBeNull();
    expect(computeBmi(undefined, 170)).toBeNull();
    expect(computeBmi(0, 170)).toBeNull();
  });
});
