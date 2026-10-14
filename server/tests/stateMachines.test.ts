import { Types, type Model } from 'mongoose';
import { STATE_MACHINES, type Role, type StateMachine } from '../src/config/constants.js';
import { Appointment } from '../src/modules/appointments/model.js';
import { Encounter } from '../src/modules/encounters/model.js';
import { PatientExplanation } from '../src/modules/explanations/model.js';
import { FollowupRequest } from '../src/modules/followups/model.js';
import { Invoice } from '../src/modules/invoices/model.js';
import { LabOrder } from '../src/modules/labOrders/model.js';
import { Payment } from '../src/modules/payments/model.js';
import { Prescription } from '../src/modules/prescriptions/model.js';
import { ClinicalSummary } from '../src/modules/summaries/model.js';
import { ApiError } from '../src/utils/ApiError.js';
import { assertTransition, canTransition } from '../src/utils/stateMachine.js';
import { resetDb } from './helpers/auth.js';
import { captureEmails } from './helpers/email.js';
import { buildContext, send } from './helpers/rbacContext.js';
import { ENDPOINTS, routeKey, type Ctx } from './helpers/rbacMatrix.js';

/**
 * Every state machine (spec §5; invoice D144, follow-up request D156). Part 1 checks every pair
 * of statuses against the tables below, written from the spec – not copied from constants.ts.
 * Part 2 calls every status action on a record in every status the action must refuse: 409
 * INVALID_STATUS_TRANSITION and the record unchanged. The records come from the RBAC matrix
 * context, where each action succeeds, so only the status differs.
 */

const SPEC: Record<StateMachine, Record<string, readonly string[]>> = {
  appointment: {
    scheduled: ['scheduled', 'checked_in', 'cancelled', 'no_show'],
    checked_in: ['in_consultation', 'cancelled'],
    in_consultation: ['completed'],
    no_show: ['scheduled'],
    completed: [],
    cancelled: [],
  },
  encounter: { draft: ['signed'], signed: ['amended'], amended: ['amended'] },
  prescription: {
    draft: ['issued'],
    issued: ['completed', 'cancelled'],
    completed: [],
    cancelled: [],
  },
  labOrder: {
    draft: ['ordered', 'cancelled'],
    ordered: ['sample_collected', 'cancelled'],
    sample_collected: ['sample_rejected', 'processing', 'cancelled'],
    sample_rejected: ['ordered', 'cancelled'],
    processing: ['result_entered', 'cancelled'],
    result_entered: ['processing', 'verified'],
    verified: ['released'],
    released: ['released'],
    cancelled: [],
  },
  invoice: {
    draft: ['issued', 'void'],
    issued: ['partially_paid', 'paid', 'void'],
    partially_paid: ['partially_paid', 'paid', 'issued', 'void'],
    paid: ['partially_paid', 'issued'],
    void: [],
  },
  followupRequest: {
    open: ['in_review', 'responded', 'scheduled', 'closed', 'rejected'],
    in_review: ['responded', 'scheduled', 'closed', 'rejected'],
    responded: ['open', 'scheduled', 'closed', 'rejected'],
    scheduled: [],
    closed: [],
    rejected: [],
  },
  clinicalSummary: {
    generating: ['draft', 'failed'],
    draft: ['approved', 'rejected', 'superseded'],
    approved: ['superseded'],
    rejected: [],
    failed: [],
    superseded: [],
  },
} as Record<StateMachine, Record<string, readonly string[]>>;

const statusesOf = (machine: StateMachine) => [
  ...new Set([
    ...Object.keys(SPEC[machine]),
    ...Object.keys(STATE_MACHINES[machine] as Record<string, unknown>),
  ]),
];

let cases = 0;
afterAll(() => {
  process.stdout.write(`\nState machines: ${cases} cases\n`);
});

describe('transition tables match spec §5 (every pair)', () => {
  it('covers every machine in STATE_MACHINES', () => {
    expect(Object.keys(SPEC).sort()).toEqual(Object.keys(STATE_MACHINES).sort());
  });

  for (const machine of Object.keys(SPEC) as StateMachine[]) {
    it(`${machine}: allowed pairs pass, every other pair → 409 INVALID_STATUS_TRANSITION`, () => {
      const statuses = statusesOf(machine);
      for (const from of statuses) {
        for (const to of statuses) {
          cases += 1;
          const allowed = SPEC[machine][from]?.includes(to) ?? false;
          expect(canTransition(machine, from, to), `${machine} ${from} → ${to}`).toBe(allowed);
          if (allowed) continue;
          let error: unknown;
          try {
            assertTransition(machine, from, to as never);
          } catch (err) {
            error = err;
          }
          expect(error, `${machine} ${from} → ${to}`).toBeInstanceOf(ApiError);
          expect(error).toMatchObject({
            statusCode: 409,
            code: 'INVALID_STATUS_TRANSITION',
            details: { from, to },
          });
        }
      }
    });
  }
});

interface Action {
  /** The RBAC matrix row (its path, body and an allowed role). */
  route: string;
  role: Role;
  machine: StateMachine;
  model: Model<never>;
  /** The record whose status the action changes. */
  id: (c: Ctx) => string;
  /** Statuses the action starts from (spec §5); every other status must be refused. */
  from: readonly string[];
}

const ACTIONS: Action[] = [
  // Appointments (§5.1 table)
  {
    route: 'POST /appointments/:id/reschedule',
    role: 'receptionist',
    machine: 'appointment',
    model: Appointment as never,
    id: (c) => c.appointmentId,
    from: ['scheduled'],
  },
  {
    route: 'POST /appointments/:id/cancel',
    role: 'receptionist',
    machine: 'appointment',
    model: Appointment as never,
    id: (c) => c.appointmentId,
    from: ['scheduled', 'checked_in'],
  },
  {
    route: 'POST /appointments/:id/check-in',
    role: 'receptionist',
    machine: 'appointment',
    model: Appointment as never,
    id: (c) => c.todayScheduledId,
    from: ['scheduled'],
  },
  {
    route: 'POST /appointments/:id/start',
    role: 'doctor',
    machine: 'appointment',
    model: Appointment as never,
    id: (c) => c.checkedInId,
    from: ['checked_in'],
  },
  {
    route: 'POST /appointments/:id/complete',
    role: 'doctor',
    machine: 'appointment',
    model: Appointment as never,
    id: (c) => c.inConsultationId,
    from: ['in_consultation'],
  },
  {
    route: 'POST /appointments/:id/no-show',
    role: 'receptionist',
    machine: 'appointment',
    model: Appointment as never,
    id: (c) => c.todayScheduledId,
    from: ['scheduled'],
  },
  {
    route: 'POST /appointments/:id/undo-no-show',
    role: 'receptionist',
    machine: 'appointment',
    model: Appointment as never,
    id: (c) => c.noShowId,
    from: ['no_show'],
  },
  // Encounters (§5.2)
  {
    route: 'POST /encounters/:id/sign',
    role: 'doctor',
    machine: 'encounter',
    model: Encounter as never,
    id: (c) => c.signableEncounterId,
    from: ['draft'],
  },
  {
    route: 'POST /encounters/:id/amendments',
    role: 'doctor',
    machine: 'encounter',
    model: Encounter as never,
    id: (c) => c.signedEncounterId,
    from: ['signed', 'amended'],
  },
  // Prescriptions (§5.3)
  {
    route: 'POST /prescriptions/:id/issue',
    role: 'doctor',
    machine: 'prescription',
    model: Prescription as never,
    id: (c) => c.reissuedDraftId,
    from: ['draft'],
  },
  {
    route: 'POST /prescriptions/:id/cancel',
    role: 'doctor',
    machine: 'prescription',
    model: Prescription as never,
    id: (c) => c.prescriptionId,
    from: ['issued'],
  },
  {
    route: 'POST /prescriptions/:id/reissue',
    role: 'doctor',
    machine: 'prescription',
    model: Prescription as never,
    id: (c) => c.prescriptionId,
    from: ['issued'],
  },
  // Lab orders (§5.4)
  {
    route: 'POST /lab-orders/:id/discard',
    role: 'doctor',
    machine: 'labOrder',
    model: LabOrder as never,
    id: (c) => c.draftLabOrderId,
    from: ['draft'],
  },
  {
    route: 'POST /lab-orders/:id/cancel',
    role: 'doctor',
    machine: 'labOrder',
    model: LabOrder as never,
    id: (c) => c.labOrderId,
    from: ['ordered', 'sample_collected', 'sample_rejected', 'processing'],
  },
  {
    route: 'POST /lab-orders/:id/collect-sample',
    role: 'labtech',
    machine: 'labOrder',
    model: LabOrder as never,
    id: (c) => c.labOrderId,
    from: ['ordered'],
  },
  {
    route: 'POST /lab-orders/:id/reject-sample',
    role: 'labtech',
    machine: 'labOrder',
    model: LabOrder as never,
    id: (c) => c.collectedLabOrderId,
    from: ['sample_collected'],
  },
  {
    route: 'POST /lab-orders/:id/recollect',
    role: 'labtech',
    machine: 'labOrder',
    model: LabOrder as never,
    id: (c) => c.rejectedLabOrderId,
    from: ['sample_rejected'],
  },
  {
    route: 'POST /lab-orders/:id/start-processing',
    role: 'labtech',
    machine: 'labOrder',
    model: LabOrder as never,
    id: (c) => c.collectedLabOrderId,
    from: ['sample_collected'],
  },
  {
    route: 'POST /lab-orders/:id/verify',
    role: 'labtech',
    machine: 'labOrder',
    model: LabOrder as never,
    id: (c) => c.enteredLabOrderId,
    from: ['result_entered'],
  },
  {
    route: 'POST /lab-orders/:id/send-back',
    role: 'labtech',
    machine: 'labOrder',
    model: LabOrder as never,
    id: (c) => c.enteredLabOrderId,
    from: ['result_entered'],
  },
  {
    route: 'POST /lab-orders/:id/release',
    role: 'labtech',
    machine: 'labOrder',
    model: LabOrder as never,
    id: (c) => c.verifiedLabOrderId,
    from: ['verified'],
  },
  // Invoices (§5.5, D144)
  {
    route: 'POST /invoices/:id/issue',
    role: 'receptionist',
    machine: 'invoice',
    model: Invoice as never,
    id: (c) => c.draftInvoiceId,
    from: ['draft'],
  },
  {
    route: 'POST /invoices/:id/void',
    role: 'receptionist',
    machine: 'invoice',
    model: Invoice as never,
    id: (c) => c.issuedInvoiceId,
    from: ['draft', 'issued', 'partially_paid'],
  },
  {
    route: 'POST /invoices/:id/payments',
    role: 'receptionist',
    machine: 'invoice',
    model: Invoice as never,
    id: (c) => c.issuedInvoiceId,
    from: ['issued', 'partially_paid'],
  },
  // Follow-up requests (§5.6, D156)
  {
    route: 'POST /follow-up-requests/:id/review',
    role: 'receptionist',
    machine: 'followupRequest',
    model: FollowupRequest as never,
    id: (c) => c.followupId,
    from: ['open'],
  },
  {
    route: 'POST /follow-up-requests/:id/schedule',
    role: 'receptionist',
    machine: 'followupRequest',
    model: FollowupRequest as never,
    id: (c) => c.followupId,
    from: ['open', 'in_review', 'responded'],
  },
  {
    route: 'POST /follow-up-requests/:id/close',
    role: 'receptionist',
    machine: 'followupRequest',
    model: FollowupRequest as never,
    id: (c) => c.followupId,
    from: ['open', 'in_review', 'responded'],
  },
  {
    route: 'POST /follow-up-requests/:id/reject',
    role: 'receptionist',
    machine: 'followupRequest',
    model: FollowupRequest as never,
    id: (c) => c.followupId,
    from: ['open', 'in_review', 'responded'],
  },
  // AI clinical summaries (§5.7)
  {
    route: 'POST /encounters/:id/summary/:summaryId/approve',
    role: 'doctor',
    machine: 'clinicalSummary',
    model: ClinicalSummary as never,
    id: (c) => c.summaryId,
    from: ['draft'],
  },
  {
    route: 'POST /encounters/:id/summary/:summaryId/reject',
    role: 'doctor',
    machine: 'clinicalSummary',
    model: ClinicalSummary as never,
    id: (c) => c.summaryId,
    from: ['draft'],
  },
];

/**
 * Refusals answered with another code than §5's 409, waiting for the project owner's decision
 * (Phase 11 RBAC/contract rule: report, do not change). Each entry: action + status → code.
 */
const PENDING_DECISION: Record<string, { status: number; code: string }> = {
  // Paying a fully paid invoice: 422 "This invoice is fully paid" (payments.test.ts), not 409.
  'POST /invoices/:id/payments from paid': { status: 422, code: 'PAYMENT_EXCEEDS_BALANCE' },
};

describe('every status action refuses every other status: 409, record unchanged', () => {
  let emails: ReturnType<typeof captureEmails>;
  beforeAll(async () => {
    await Promise.all([
      Appointment.init(),
      Encounter.init(),
      Prescription.init(),
      LabOrder.init(),
      Invoice.init(),
      Payment.init(),
      ClinicalSummary.init(),
      PatientExplanation.init(),
    ]);
    await resetDb();
    emails = captureEmails();
  });
  afterAll(() => emails.restore());

  it('every action route is a matrix row allowing its role', () => {
    for (const a of ACTIONS) {
      expect(
        ENDPOINTS.some((r) => routeKey(r) === a.route && r.roles.includes(a.role)),
        a.route,
      ).toBe(true);
    }
  });

  for (const a of ACTIONS) {
    const refused = statusesOf(a.machine).filter((s) => !a.from.includes(s));
    it(`${a.route}: from ${refused.join(', ')} → 409`, async () => {
      const row = ENDPOINTS.find((r) => routeKey(r) === a.route && r.roles.includes(a.role))!;
      const c = await buildContext(a.role);
      const id = a.id(c);
      for (const status of refused) {
        cases += 1;
        // Raw driver update: skips the immutability hooks, so any status can be set up.
        await a.model.collection.updateOne({ _id: new Types.ObjectId(id) }, { $set: { status } });
        const before = await a.model.collection.findOne({ _id: new Types.ObjectId(id) });
        const res = await send(row, c);
        const expected = PENDING_DECISION[`${a.route} from ${status}`] ?? {
          status: 409,
          code: 'INVALID_STATUS_TRANSITION',
        };
        expect(res.status, `${a.route} from ${status}: ${JSON.stringify(res.body)}`).toBe(
          expected.status,
        );
        expect(res.body.error.code, `${a.route} from ${status}`).toBe(expected.code);
        const after = await a.model.collection.findOne({ _id: new Types.ObjectId(id) });
        expect(after, `${a.route} from ${status} changed the record`).toEqual(before);
      }
    });
  }
});
