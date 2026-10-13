import { JOB_RULES, LAB_OPEN_STATUSES, NOTIFICATION_TYPES, ROLES } from '../config/constants.js';
import { LabOrder } from '../modules/labOrders/model.js';
import { User } from '../modules/users/model.js';
import { notificationLink, notify } from '../services/notification.service.js';
import { emitLabWorklistUpdated } from '../socket/emitter.js';
import { logger, serializeError } from '../utils/logger.js';

export interface LabTatJobResult {
  marked: number;
  skipped: number;
  failed: number;
}

const HOUR_MS = 60 * 60_000;

/** The longest turnaround time of the order's open (not cancelled) tests, in hours. */
const longestTurnaround = {
  $max: {
    $map: {
      input: { $filter: { input: '$items', as: 'i', cond: { $ne: ['$$i.status', 'cancelled'] } } },
      as: 'i',
      in: '$$i.testSnapshot.turnaroundHours',
    },
  },
};

/**
 * Lab turnaround alerts (spec §8.11; hourly): orders still in the lab whose longest test
 * turnaround time has passed since they were placed (`orderedAt + max(turnaroundHours)`) get
 * `tatBreachedAt`, once – claimed with a conditional update, so a second run never marks one
 * again – and the lab's worklists refresh (`lab.worklist.updated`, ids only). Tests without a
 * turnaround time never breach. Each marked order is an in-app alert to every active lab
 * technician (spec §11), once per order (dedupe key).
 */
async function notifyLabTechs(o: { _id: unknown; orderNumber?: string | null }) {
  const techs = await User.find({ role: ROLES.LABTECH, isActive: true }).select('_id').lean();
  const id = String(o._id);
  await notify({
    recipients: techs.map((t) => ({ userId: t._id.toString() })),
    type: NOTIFICATION_TYPES.LAB_TAT_OVERDUE,
    title: 'Lab order overdue',
    body: `${o.orderNumber ?? 'A lab order'} is past its turnaround time.`,
    link: notificationLink(NOTIFICATION_TYPES.LAB_TAT_OVERDUE, ROLES.LABTECH, id),
    data: { labOrderId: id, ...(o.orderNumber ? { orderNumber: o.orderNumber } : {}) },
    dedupeKey: `${NOTIFICATION_TYPES.LAB_TAT_OVERDUE}:${id}`,
  });
}

export async function runLabTatJob(now = new Date()): Promise<LabTatJobResult> {
  const due = await LabOrder.find({
    status: { $in: LAB_OPEN_STATUSES },
    tatBreachedAt: null,
    orderedAt: { $type: 'date', $lte: now },
    $expr: {
      $and: [
        { $gt: [longestTurnaround, 0] },
        { $lte: [{ $add: ['$orderedAt', { $multiply: [longestTurnaround, HOUR_MS] }] }, now] },
      ],
    },
  })
    .select('_id orderNumber')
    .sort({ orderedAt: 1 })
    .limit(JOB_RULES.batchSize)
    .lean();

  const result: LabTatJobResult = { marked: 0, skipped: 0, failed: 0 };
  const marked: string[] = [];
  for (const o of due) {
    try {
      const res = await LabOrder.updateOne(
        { _id: o._id, tatBreachedAt: null, status: { $in: LAB_OPEN_STATUSES } },
        { $set: { tatBreachedAt: now } },
      );
      if (res.modifiedCount === 0) {
        result.skipped += 1;
        continue;
      }
      marked.push(o._id.toString());
      result.marked += 1;
      await notifyLabTechs(o);
    } catch (err) {
      result.failed += 1;
      logger.error({ err: serializeError(err), job: 'lab-tat' }, 'Lab TAT marking failed');
    }
  }
  emitLabWorklistUpdated(marked);
  logger.info({ job: 'lab-tat', due: due.length, ...result }, 'Lab TAT job finished');
  return result;
}
