import type { Role } from '../../src/config/constants.js';
import { Department } from '../../src/modules/departments/model.js';
import { Document as DocumentModel } from '../../src/modules/documents/model.js';
import { LabOrder } from '../../src/modules/labOrders/model.js';
import { getStorage } from '../../src/services/storage/index.js';
import { LabTest } from '../../src/modules/labTests/model.js';
import { DoctorLeave } from '../../src/modules/leaves/model.js';
import { FollowupRequest } from '../../src/modules/followups/model.js';
import { Invoice } from '../../src/modules/invoices/model.js';
import { Payment } from '../../src/modules/payments/model.js';
import { Patient } from '../../src/modules/patients/model.js';
import { Service } from '../../src/modules/services/model.js';
import { User } from '../../src/modules/users/model.js';
import { verifyAccessToken } from '../../src/utils/tokens.js';
import { createUser, loginAs, TEST_PASSWORD } from './auth.js';
import {
  addDoctorProfile,
  at,
  createDoctor,
  createPatient,
  createSchedule,
  insertAppointment,
  createLabTest,
  insertLabOrder,
  nextWeekday,
} from './fixtures.js';
import { addDaysToDate, clinicToday, startOfClinicDay } from '../../src/utils/dates.js';
import { ensureEncounterDraft } from '../../src/modules/encounters/draft.js';
import { Encounter } from '../../src/modules/encounters/model.js';
import { Prescription } from '../../src/modules/prescriptions/model.js';
import { loadEncounter } from '../../src/modules/encounters/service.js';
import { buildSummaryInput } from '../../src/modules/summaries/input.js';
import { ClinicalSummary } from '../../src/modules/summaries/model.js';
import { PatientExplanation } from '../../src/modules/explanations/model.js';
import { Notification } from '../../src/modules/notifications/model.js';
import { withTransaction } from '../../src/utils/transaction.js';
import { letters, MATRIX_PDF, type Ctx, type Row } from './rbacMatrix.js';
import { api } from './testApp.js';

/**
 * Fixtures for the RBAC matrix (rbac.test.ts) and the ownership matrix (rbac.ownership.test.ts):
 * `buildContext(role)` creates a full set of records owned by a fresh user of `role`;
 * `PLACEHOLDER_IDS` match no record; `send` makes a row's request.
 */

let n = 0;

export async function buildContext(role: Role): Promise<Ctx> {
  n += 1;
  const me = await loginAs(role);
  const second = await api()
    .post('/api/v1/auth/login')
    .send({ email: me.user.email, password: TEST_PASSWORD });
  const target = await createUser('labtech');
  const inactive = await createUser('labtech', { isActive: false });
  const [department, inactiveDepartment] = await Department.create([
    { name: `Dept ${n}`, code: `D${letters(n)}` },
    { name: `Old dept ${n}`, code: `O${letters(n)}`, isActive: false },
  ]);
  const [service, inactiveService] = await Service.create([
    { code: `S-${n}`, name: 'Service', type: 'other', pricePaise: 100 },
    { code: `OS-${n}`, name: 'Old service', type: 'other', pricePaise: 100, isActive: false },
  ]);
  // Doctors get their own department, so `departmentId` can still be deactivated. Each code
  // family starts with its own letter (D…, O…, X…), so codes never collide as `n` grows.
  const doctorDepartment = (
    await Department.create({ name: `Doctors ${n}`, code: `X${letters(n)}` })
  )._id;
  if (role === 'doctor') await addDoctorProfile(me.user._id, { department: doctorDepartment });
  const doctorId =
    role === 'doctor'
      ? me.user._id.toString()
      : (await createDoctor({}, { department: doctorDepartment })).id;
  const other = await createDoctor({}, { department: doctorDepartment });
  const leave = await DoctorLeave.create({
    doctor: doctorId,
    startAt: new Date(Date.now() + 30 * 86_400_000),
    endAt: new Date(Date.now() + 31 * 86_400_000),
  });
  const labTest = { category: 'other', sampleType: 'blood', pricePaise: 100 };
  const [lab, inactiveLab] = await LabTest.create([
    { ...labTest, code: `LT-A${n}`, name: 'Lab test' },
    { ...labTest, code: `LT-B${n}`, name: 'Old lab test', isActive: false },
  ]);
  const patient = await createPatient();
  const otherPatient = await createPatient();
  const inactivePatient = await createPatient({ isActive: false });
  const invitable = await createPatient({ email: `invite${n}@example.com` });
  const pendingPatient = await createPatient({ dateOfBirth: '1991-02-03' });
  const pendingUser = await createUser('patient', {
    patient: pendingPatient.id,
    patientLinkStatus: 'pending_verification',
    dateOfBirth: new Date('1991-02-03T00:00:00Z'),
  });
  if (role === 'patient') {
    await User.updateOne(
      { _id: me.user._id },
      { $set: { patient: patient.id, patientLinkStatus: 'linked' } },
    );
    await Patient.updateOne({ _id: patient.id }, { $set: { user: me.user._id } });
  }
  // A bookable doctor (09:00–13:00 daily) and a scheduled appointment of `patient` with them.
  // Works all day, so a walk-in always finds a running session (except 23:55–24:00 IST).
  await createSchedule(doctorId, [{ start: '00:00', end: '23:55' }]);
  const appointmentDate = nextWeekday(2, 3); // a Tuesday
  const appointment = await insertAppointment({
    patient: patient.id,
    doctor: doctorId,
    startAt: at(appointmentDate, '09:00'),
    service: service!._id,
  });
  // Today's queue: minutes after clinic midnight, so each has already started.
  const today = clinicToday('Asia/Kolkata');
  const todayAt = (minutes: number, date = today) =>
    new Date(startOfClinicDay(date, 'Asia/Kolkata').getTime() + minutes * 60_000);
  const todays = async (minutes: number, status: string, extra: Record<string, unknown> = {}) =>
    insertAppointment({
      patient: (extra.patient as string | undefined) ?? (await createPatient()).id,
      doctor: doctorId,
      startAt: todayAt(minutes, (extra.date as string | undefined) ?? today),
      status,
      minutes: 1, // one minute each, so they do not overlap
      service: service!._id,
      queue: status === 'scheduled' ? {} : { tokenNumber: minutes, checkedInAt: todayAt(minutes) },
    });
  const todayScheduled = await todays(1, 'scheduled');
  const checkedIn = await todays(2, 'checked_in', { patient: patient.id });
  const noShow = await todays(3, 'no_show');
  const inConsultation = await todays(4, 'in_consultation', {
    date: addDaysToDate(today, -1),
  });
  const walkInPatient = await createPatient();
  const encounter = await withTransaction((session) =>
    ensureEncounterDraft(inConsultation, { by: doctorId, year: 2026, session }),
  );
  // Phase 5 step 2: a note ready to sign, two signed notes, an issued and a reissued prescription.
  const note = async (appt: Parameters<typeof ensureEncounterDraft>[0], status = 'draft') => {
    const e = await withTransaction((session) =>
      ensureEncounterDraft(appt, { by: doctorId, year: 2026, session }),
    );
    await Encounter.collection.updateOne(
      { _id: e.id },
      {
        $set: {
          status,
          chiefComplaint: 'Matrix complaint',
          diagnoses: [{ description: 'Matrix diagnosis', type: 'provisional', isPrimary: true }],
          ...(status === 'signed' ? { signedAt: new Date(), signedBy: doctorId } : {}),
        },
      },
    );
    return e.id;
  };
  const signable = await note(
    await todays(5, 'in_consultation', { date: addDaysToDate(today, -1) }),
  );
  const past = (days: number) =>
    insertAppointment({
      patient: patient.id,
      doctor: doctorId,
      startAt: new Date(Date.now() - days * 86_400_000),
      status: 'completed',
      isSlotActive: false,
      service: service!._id,
    });
  const signedAppt = await past(3);
  const signedEncounter = await note(signedAppt, 'signed');
  const rxItems = [
    { drugName: 'Paracetamol', dose: '1 tablet', frequency: 'TDS', durationDays: 3 },
  ];
  const rxBase = {
    patient: patient.id,
    doctor: doctorId,
    items: rxItems,
  };
  const prescription = await Prescription.create({
    ...rxBase,
    encounter: signedEncounter,
    appointment: signedAppt._id,
    status: 'issued',
    prescriptionNumber: `RX-1999-${String(n).padStart(6, '0')}`,
    issuedAt: new Date(),
  });
  const otherAppt = await past(5);
  const otherSigned = await note(otherAppt, 'signed');
  const [cancelledRx] = await Prescription.create([
    {
      ...rxBase,
      encounter: otherSigned,
      appointment: otherAppt._id,
      status: 'cancelled',
      isCurrent: false,
      prescriptionNumber: `RX-1998-${String(n).padStart(6, '0')}`,
    },
  ]);
  const reissued = await Prescription.create({
    ...rxBase,
    encounter: otherSigned,
    appointment: otherAppt._id,
    replaces: cancelledRx!._id,
  });
  // Phase 6: lab orders of doctorId – a draft on the draft note, a placed one and a released one
  // for `patient`.
  const labTests = [{ _id: lab!._id, code: lab!.code, name: lab!.name, pricePaise: 100 }];
  const draftLabOrder = await insertLabOrder({
    patient: inConsultation.patient,
    doctor: doctorId,
    status: 'draft',
    encounter: encounter.id,
    appointment: inConsultation._id,
    tests: labTests,
  });
  const labOrder = await insertLabOrder({
    patient: patient.id,
    doctor: doctorId,
    encounter: signedEncounter,
    appointment: signedAppt._id,
    tests: [...labTests, ...labTests],
  });
  const releasedLabOrder = await insertLabOrder({
    patient: patient.id,
    doctor: doctorId,
    status: 'released',
    encounter: signedEncounter,
    appointment: signedAppt._id,
    items: [
      {
        test: lab!._id,
        testSnapshot: { code: lab!.code, name: lab!.name, pricePaise: 100 },
        status: 'verified',
      },
    ],
    releasedAt: new Date(),
  });
  // Step 2: an order in each workflow status. `target` (another lab technician) entered the
  // results and made the pending revision, so a lab tech caller may verify them.
  const hbTest = await createLabTest();
  const workflow = (status: string, extra: Record<string, unknown> = {}) =>
    insertLabOrder({
      patient: patient.id,
      doctor: doctorId,
      status,
      encounter: signedEncounter,
      appointment: signedAppt._id,
      tests: [{ _id: hbTest._id, code: hbTest.code, name: hbTest.name, pricePaise: 100 }],
      ...extra,
    });
  const hbItem = (status: string, extra: Record<string, unknown> = {}) => ({
    test: hbTest._id,
    testSnapshot: { code: hbTest.code, name: hbTest.name, pricePaise: 100 },
    status,
    results: [{ parameterKey: 'hb', name: 'Haemoglobin', value: 14, flag: 'normal' }],
    enteredBy: target._id,
    enteredAt: new Date(),
    ...extra,
  });
  const collected = await workflow('sample_collected', {
    sample: { sampleId: `S99-${String(n).padStart(6, '0')}`, collectedAt: new Date() },
  });
  const rejected = await workflow('sample_rejected');
  const processing = await workflow('processing');
  const entered = await workflow('result_entered', { items: [hbItem('result_entered')] });
  const verified = await workflow('verified', { items: [hbItem('verified')] });
  const revision = await workflow('released', {
    items: [
      hbItem('verified', {
        pendingRevision: {
          results: [{ parameterKey: 'hb', name: 'Haemoglobin', value: 13, flag: 'normal' }],
          reason: 'Matrix correction',
          by: target._id,
          at: new Date(),
        },
      }),
    ],
    releasedAt: new Date(),
  });
  // Documents: a generated lab report of `patient` (also the released order's report) and a
  // document the caller uploaded just now.
  const docBase = {
    patient: patient.id,
    mimeType: 'application/pdf',
    sizeBytes: MATRIX_PDF.length,
    storageDriver: 'local',
    storageKey: (
      await getStorage().save(MATRIX_PDF, { mimeType: 'application/pdf', originalName: 'x.pdf' })
    ).storageKey,
    checksumSha256: 'b'.repeat(64),
  };
  const report = await DocumentModel.create({
    ...docBase,
    category: 'lab_report',
    title: 'Lab report',
    originalName: 'report.pdf',
    isGenerated: true,
    visibleToPatient: true,
    linked: { type: 'lab_order', id: releasedLabOrder._id },
  });
  await LabOrder.updateOne({ _id: releasedLabOrder._id }, { $set: { reportDocument: report._id } });
  const mine = await DocumentModel.create({
    ...docBase,
    category: 'other',
    title: 'My upload',
    originalName: 'mine.pdf',
    uploadedBy: me.user._id,
    uploadedByRole: role,
  });
  // Phase 7: a manual draft and an unpaid issued invoice of `patient`.
  const invoiceLine = {
    kind: 'other',
    origin: 'staff',
    description: 'Matrix line',
    quantity: 1,
    unitPricePaise: 1000,
    discountPaise: 0,
    taxRateBps: 0,
    taxPaise: 0,
    lineTotalPaise: 1000,
  };
  const invoiceBase = {
    kind: 'manual',
    patient: patient.id,
    items: [invoiceLine],
    subtotalPaise: 1000,
    totalPaise: 1000,
    balancePaise: 1000,
  };
  const [draftInvoice, issuedInvoice, paidInvoice] = await Invoice.create([
    { ...invoiceBase, status: 'draft' },
    {
      ...invoiceBase,
      status: 'issued',
      invoiceNumber: `INV-1999-${String(n).padStart(6, '0')}`,
      issuedAt: new Date(),
    },
    {
      ...invoiceBase,
      status: 'partially_paid',
      invoiceNumber: `INV-1998-${String(n).padStart(6, '0')}`,
      issuedAt: new Date(),
      amountPaidPaise: 500,
      balancePaise: 500,
    },
  ]);
  const payment = await Payment.create({
    paymentNumber: `PAY-1999-${String(n).padStart(6, '0')}`,
    invoice: paidInvoice!._id,
    patient: patient.id,
    amountPaise: 500,
    method: 'cash',
    kind: 'payment',
    receivedBy: target._id,
    receivedAt: new Date(),
  });
  // Phase 8: an open follow-up request of `patient` assigned to doctorId.
  const followup = await FollowupRequest.create({
    requestNumber: `FUR-1999-${String(n).padStart(6, '0')}`,
    patient: patient.id,
    assignedDoctor: doctorId,
    type: 'question',
    message: 'Matrix question',
    status: 'open',
    statusHistory: [{ status: 'open', at: new Date() }],
  });
  // Phase 9: an up-to-date draft AI summary of the signed note (built last: its input hash covers
  // the note's prescription and lab orders).
  await Encounter.collection.updateOne(
    { _id: signedEncounter },
    { $set: { 'followUp.required': true, 'followUp.afterDays': 7 } },
  );
  await PatientExplanation.create({
    sourceType: 'prescription',
    sourceId: prescription._id,
    sourceVersion: 1,
    patient: patient.id,
    language: 'en',
    content: { overview: 'Matrix explanation', medicines: [] },
    disclaimer: 'Matrix disclaimer',
    outcome: 'success',
    cached: true,
    requestedBy: me.user._id,
  });
  const signedNote = await loadEncounter(signedEncounter);
  const { inputHash } = await buildSummaryInput(signedNote);
  const summary = await ClinicalSummary.create({
    encounter: signedEncounter,
    encounterVersion: signedNote.version,
    inputHash,
    patient: patient.id,
    doctor: doctorId,
    status: 'draft',
    finalText: 'Matrix AI summary',
    generatedBy: doctorId,
    generatedAt: new Date(),
  });
  return {
    me,
    targetId: target._id.toString(),
    inactiveId: inactive._id.toString(),
    otherSessionId: verifyAccessToken(second.body.data.accessToken).sid,
    departmentId: department!._id.toString(),
    inactiveDepartmentId: inactiveDepartment!._id.toString(),
    serviceId: service!._id.toString(),
    inactiveServiceId: inactiveService!._id.toString(),
    doctorId,
    otherDoctorId: other.id,
    leaveId: leave._id.toString(),
    labTestId: lab!._id.toString(),
    inactiveLabTestId: inactiveLab!._id.toString(),
    patientId: patient.id,
    otherPatientId: otherPatient.id,
    inactivePatientId: inactivePatient.id,
    invitablePatientId: invitable.id,
    pendingUserId: pendingUser._id.toString(),
    pendingPatientId: pendingPatient.id,
    appointmentId: appointment._id.toString(),
    appointmentDate,
    bookStartAt: at(addDaysToDate(appointmentDate, 1), '10:00').toISOString(),
    rescheduleStartAt: at(appointmentDate, '11:00').toISOString(),
    todayScheduledId: todayScheduled._id.toString(),
    checkedInId: checkedIn._id.toString(),
    queueAppointmentId: checkedIn._id.toString(),
    noShowId: noShow._id.toString(),
    inConsultationId: inConsultation._id.toString(),
    walkInPatientId: walkInPatient.id,
    encounterId: encounter.id.toString(),
    signableEncounterId: signable.toString(),
    signedEncounterId: signedEncounter.toString(),
    prescriptionId: prescription._id.toString(),
    reissuedDraftId: reissued._id.toString(),
    draftLabOrderId: draftLabOrder._id.toString(),
    labOrderId: labOrder._id.toString(),
    labItemId: labOrder.items[0]!._id.toString(),
    releasedLabOrderId: releasedLabOrder._id.toString(),
    releasedLabItemId: releasedLabOrder.items[0]!._id.toString(),
    collectedLabOrderId: collected._id.toString(),
    rejectedLabOrderId: rejected._id.toString(),
    processingLabOrderId: processing._id.toString(),
    processingLabItemId: processing.items[0]!._id.toString(),
    enteredLabOrderId: entered._id.toString(),
    verifiedLabOrderId: verified._id.toString(),
    revisionLabOrderId: revision._id.toString(),
    revisionLabItemId: revision.items[0]!._id.toString(),
    documentId: report._id.toString(),
    myDocumentId: mine._id.toString(),
    draftInvoiceId: draftInvoice!._id.toString(),
    issuedInvoiceId: issuedInvoice!._id.toString(),
    paidInvoiceId: paidInvoice!._id.toString(),
    paymentId: payment._id.toString(),
    followupId: followup._id.toString(),
    summaryId: summary._id.toString(),
    notificationId: (
      await Notification.create({
        recipient: me.user._id,
        type: 'appointment.booked',
        title: 'Appointment confirmed',
      })
    )._id.toString(),
    n,
  };
}

const zero = '0'.repeat(24);

/** Ids that match no record: the context of anonymous and denied calls. */
export const PLACEHOLDER_IDS = {
  targetId: zero,
  inactiveId: zero,
  otherSessionId: zero,
  departmentId: zero,
  inactiveDepartmentId: zero,
  serviceId: zero,
  inactiveServiceId: zero,
  doctorId: zero,
  otherDoctorId: zero,
  leaveId: zero,
  labTestId: zero,
  inactiveLabTestId: zero,
  patientId: zero,
  otherPatientId: zero,
  inactivePatientId: zero,
  invitablePatientId: zero,
  pendingUserId: zero,
  pendingPatientId: zero,
  appointmentId: zero,
  appointmentDate: '2030-01-01',
  bookStartAt: '2030-01-01T04:30:00.000Z',
  rescheduleStartAt: '2030-01-01T05:30:00.000Z',
  todayScheduledId: zero,
  checkedInId: zero,
  queueAppointmentId: zero,
  noShowId: zero,
  inConsultationId: zero,
  walkInPatientId: zero,
  encounterId: zero,
  signableEncounterId: zero,
  signedEncounterId: zero,
  prescriptionId: zero,
  reissuedDraftId: zero,
  draftLabOrderId: zero,
  labOrderId: zero,
  labItemId: zero,
  releasedLabOrderId: zero,
  releasedLabItemId: zero,
  collectedLabOrderId: zero,
  rejectedLabOrderId: zero,
  processingLabOrderId: zero,
  processingLabItemId: zero,
  enteredLabOrderId: zero,
  verifiedLabOrderId: zero,
  revisionLabOrderId: zero,
  revisionLabItemId: zero,
  documentId: zero,
  myDocumentId: zero,
  draftInvoiceId: zero,
  issuedInvoiceId: zero,
  paidInvoiceId: zero,
  paymentId: zero,
  followupId: zero,
  summaryId: zero,
  notificationId: zero,
  n: 0,
} as Ctx;

export const send = (row: Row, c: Ctx | null) => {
  const ctx = c ?? PLACEHOLDER_IDS;
  let req = api()[row.method](`/api/v1${row.path(ctx)}`);
  if (c) req = req.set(c.me.auth);
  if (row.multipart && c) {
    const { fields, file, filename } = row.multipart(c);
    for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
    return req.attach('file', file, { filename, contentType: 'application/pdf' });
  }
  if (row.body) req = req.send(row.body(ctx));
  return req;
};
