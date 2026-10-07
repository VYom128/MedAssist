import { Types } from 'mongoose';
import { Invoice, allowPaymentSave, paymentWriteOptions } from '../src/modules/invoices/model.js';
import { resetDb } from './helpers/auth.js';
import { createPatient } from './helpers/fixtures.js';

/**
 * Invoice immutability at the model level (spec §10.5, Phase 7): once issued, lines, totals and
 * identity never change; status bookkeeping may; the paid amounts only with the payment
 * service's token. Invoices are never deleted.
 */

const line = {
  kind: 'other',
  origin: 'staff',
  description: 'Dressing',
  quantity: 1,
  unitPricePaise: 10_000,
  discountPaise: 0,
  taxRateBps: 0,
  taxPaise: 0,
  lineTotalPaise: 10_000,
};

let n = 0;
async function invoice(status: string, extra: Record<string, unknown> = {}) {
  n += 1;
  const { id: patient } = await createPatient();
  return Invoice.create({
    kind: 'manual',
    patient,
    status,
    items: [line],
    subtotalPaise: 10_000,
    totalPaise: 10_000,
    balancePaise: 10_000,
    ...(status === 'draft' ? {} : { invoiceNumber: `INV-1999-${String(n).padStart(6, '0')}` }),
    ...extra,
  });
}

beforeEach(async () => {
  await resetDb();
  await Invoice.init();
});

describe('issued invoices are locked', () => {
  it('refuses query updates of lines, totals, number or patient', async () => {
    const inv = await invoice('issued');
    const attempts = [
      () => Invoice.updateOne({ _id: inv._id }, { $set: { items: [] } }),
      () => Invoice.updateOne({ _id: inv._id }, { $set: { 'items.0.discountPaise': 5000 } }),
      () => Invoice.findOneAndUpdate({ _id: inv._id }, { $set: { totalPaise: 1 } }),
      () => Invoice.updateMany({}, { $set: { invoiceNumber: 'INV-1999-999999' } }),
      () => Invoice.updateOne({ _id: inv._id }, { $set: { notes: 'changed' } }),
      () => Invoice.updateOne({ _id: inv._id }, { $set: { status: 'draft' } }),
      () => Invoice.replaceOne({ _id: inv._id }, { ...inv.toObject(), items: [] }),
    ];
    for (const attempt of attempts) {
      await expect(attempt()).rejects.toMatchObject({ statusCode: 409, code: 'RECORD_LOCKED' });
    }
    const stored = await Invoice.findById(inv._id).lean();
    expect(stored!.items).toHaveLength(1);
    expect(stored!.totalPaise).toBe(10_000);
    expect(stored!.status).toBe('issued');
  });

  it('refuses paid amounts without the payment token, allows them with it', async () => {
    const inv = await invoice('issued');
    await expect(
      Invoice.updateOne({ _id: inv._id }, { $set: { amountPaidPaise: 10_000, balancePaise: 0 } }),
    ).rejects.toMatchObject({ code: 'RECORD_LOCKED' });
    await Invoice.updateOne(
      { _id: inv._id },
      { $set: { amountPaidPaise: 10_000, balancePaise: 0, status: 'paid' } },
      paymentWriteOptions(),
    );
    const stored = await Invoice.findById(inv._id).lean();
    expect(stored).toMatchObject({ amountPaidPaise: 10_000, balancePaise: 0, status: 'paid' });
  });

  it('allows status bookkeeping (void, cancelled items) without a token', async () => {
    const inv = await invoice('issued');
    await Invoice.updateOne(
      { _id: inv._id },
      {
        $push: {
          cancelledItemsBilled: {
            description: 'CBC',
            lineTotalPaise: 100,
            labOrderId: new Types.ObjectId(),
            itemId: new Types.ObjectId(),
            at: new Date(),
          },
        },
        $inc: { __v: 1 },
      },
    );
    await Invoice.updateOne(
      { _id: inv._id },
      {
        $set: { status: 'void', void: { at: new Date(), reason: 'Wrong patient' } },
        $push: { statusHistory: { status: 'void', at: new Date() } },
      },
    );
    const stored = await Invoice.findById(inv._id).lean();
    expect(stored!.status).toBe('void');
    expect(stored!.cancelledItemsBilled).toHaveLength(1);
  });

  it('save() of a loaded issued invoice: content refused, paid amounts only with the token', async () => {
    const inv = await invoice('partially_paid');
    const doc = (await Invoice.findById(inv._id))!;
    doc.items[0]!.discountPaise = 100;
    await expect(doc.save()).rejects.toMatchObject({ code: 'RECORD_LOCKED' });

    const again = (await Invoice.findById(inv._id))!;
    again.amountPaidPaise = 5000;
    await expect(again.save()).rejects.toMatchObject({ code: 'RECORD_LOCKED' });
    allowPaymentSave(again);
    again.balancePaise = 5000;
    await again.save();
    expect((await Invoice.findById(inv._id).lean())!.amountPaidPaise).toBe(5000);
  });

  it('drafts stay editable', async () => {
    const inv = await invoice('draft');
    await Invoice.updateOne(
      { _id: inv._id },
      { $set: { items: [], totalPaise: 0, balancePaise: 0, notes: 'x' } },
    );
    const doc = (await Invoice.findById(inv._id))!;
    doc.notes = 'saved';
    await doc.save();
    expect((await Invoice.findById(inv._id).lean())!).toMatchObject({ notes: 'saved', items: [] });
  });

  it('an update matching drafts and issued invoices is refused as a whole', async () => {
    await invoice('draft');
    await invoice('issued');
    await expect(Invoice.updateMany({}, { $set: { notes: 'bulk' } })).rejects.toMatchObject({
      code: 'RECORD_LOCKED',
    });
    expect(await Invoice.countDocuments({ notes: 'bulk' })).toBe(0);
  });
});

describe('never deleted', () => {
  it('refuses every delete, also of drafts, and bulk writes', async () => {
    const inv = await invoice('draft');
    const doc = (await Invoice.findById(inv._id))!;
    const attempts = [
      () => Invoice.deleteOne({ _id: inv._id }),
      () => Invoice.deleteMany({}),
      () => Invoice.findOneAndDelete({ _id: inv._id }),
      () => doc.deleteOne(),
      () => Invoice.bulkWrite([{ deleteOne: { filter: { _id: inv._id } } }]),
    ];
    for (const attempt of attempts) {
      await expect(attempt()).rejects.toMatchObject({ code: 'RECORD_LOCKED' });
    }
    expect(await Invoice.countDocuments()).toBe(1);
  });
});

describe('indexes', () => {
  it('one draft per appointment; numbers are unique', async () => {
    const appointment = new Types.ObjectId();
    await invoice('draft', { appointment });
    await expect(invoice('draft', { appointment })).rejects.toMatchObject({ code: 11000 });
    await invoice('issued', { appointment }); // an issued one beside the draft is fine
    await invoice('issued', { invoiceNumber: 'INV-1999-123456' });
    await expect(invoice('issued', { invoiceNumber: 'INV-1999-123456' })).rejects.toMatchObject({
      code: 11000,
    });
    // Drafts have no number: many drafts without one are fine (sparse).
    await invoice('draft');
    await invoice('draft');
  });
});
