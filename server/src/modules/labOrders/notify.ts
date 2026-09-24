import type { Types } from 'mongoose';
import { NOTIFICATION_TYPES, ROLES } from '../../config/constants.js';
import { notify } from '../../services/notification.service.js';
import { emitLabCritical } from '../../socket/emitter.js';
import { logger, serializeError } from '../../utils/logger.js';
import { patientRecipient } from '../appointments/service.js';
import { getSettings } from '../settings/service.js';
import { User } from '../users/model.js';
import { LabOrder } from './model.js';

/**
 * Lab notifications (spec §11). Never block or throw; call after the commit. Titles and bodies
 * carry no clinical details (§10.3) – no test names, values or flags – only "log in to see".
 */

interface OrderRefs {
  _id: Types.ObjectId;
  patient: Types.ObjectId | { _id: Types.ObjectId };
  orderedBy: Types.ObjectId | { _id: Types.ObjectId };
}
const idOf = (ref: Types.ObjectId | { _id: Types.ObjectId }) =>
  ('_id' in ref ? ref._id : ref) as Types.ObjectId;

async function doctorRecipient(doctorId: Types.ObjectId) {
  const doctor = await User.findById(doctorId).select('email').lean();
  return { userId: doctorId.toString(), email: doctor?.email ?? null };
}

/** Sample rejected (§11): the patient and receptionists are asked to arrange a new sample. */
export async function notifySampleRejected(o: OrderRefs): Promise<void> {
  try {
    const receptionists = await User.find({ role: ROLES.RECEPTIONIST, isActive: true })
      .select('email')
      .lean();
    await Promise.all([
      notify({
        recipients: [await patientRecipient(idOf(o.patient))],
        type: NOTIFICATION_TYPES.LAB_SAMPLE_REJECTED,
        title: 'Please return for a new sample',
        body: 'The clinic needs to collect a new sample from you. Please contact or visit the clinic.',
        link: '/patient/dashboard',
        email: true,
      }),
      notify({
        recipients: receptionists.map((r) => ({ userId: r._id.toString(), email: r.email })),
        type: NOTIFICATION_TYPES.LAB_SAMPLE_REJECTED,
        title: 'A patient needs a new lab sample',
        body: 'A lab sample was rejected. Please arrange for the patient to return.',
        link: `/reception/patients/${idOf(o.patient).toString()}`,
        email: true,
      }),
    ]);
  } catch (err) {
    logger.error({ err: serializeError(err) }, 'Lab notification failed');
  }
}

/** Results released or revised (§11): the patient and the ordering doctor. */
export async function notifyResultsReleased(o: OrderRefs, kind: 'release' | 'revision') {
  try {
    const id = o._id.toString();
    const revised = kind === 'revision';
    await Promise.all([
      notify({
        recipients: [await patientRecipient(idOf(o.patient))],
        type: revised
          ? NOTIFICATION_TYPES.LAB_RESULT_REVISED
          : NOTIFICATION_TYPES.LAB_RESULT_RELEASED,
        title: revised ? 'Updated lab report' : 'New lab report',
        body: revised
          ? 'An updated lab report is available – please log in to view it.'
          : 'A new lab report is available – please log in to view it.',
        link: `/patient/lab-reports/${id}`,
        email: true,
      }),
      notify({
        recipients: [await doctorRecipient(idOf(o.orderedBy))],
        type: revised
          ? NOTIFICATION_TYPES.LAB_RESULT_REVISED
          : NOTIFICATION_TYPES.LAB_RESULT_RELEASED,
        title: revised ? 'Lab results corrected' : 'Lab results ready',
        body: revised
          ? 'Lab results of one of your patients were corrected – please log in to review them.'
          : 'Lab results of one of your patients are ready – please log in to review them.',
        link: `/doctor/lab-orders/${id}`,
        email: true,
      }),
    ]);
  } catch (err) {
    logger.error({ err: serializeError(err) }, 'Lab notification failed');
  }
}

/**
 * Critical value alert (spec §8.7): email the ordering doctor (no clinical details) and emit
 * `lab.critical` to them – once per item result version. The alert is claimed with a
 * conditional update of `criticalAlertedVersion`, so parallel saves alert once. Released orders
 * pass the revision token in `queryOptions`. Off when `lab.criticalAlertEnabled` is false.
 * @returns whether an alert was sent.
 */
export async function alertCritical(
  o: OrderRefs,
  itemId: Types.ObjectId,
  version: number,
  queryOptions: Record<string, unknown> = {},
): Promise<boolean> {
  try {
    const settings = await getSettings();
    if (settings.lab?.criticalAlertEnabled === false) return false;
    const claimed = await LabOrder.updateOne(
      {
        _id: o._id,
        items: { $elemMatch: { _id: itemId, criticalAlertedVersion: { $ne: version } } },
      },
      { $set: { 'items.$[it].criticalAlertedVersion': version } },
      { arrayFilters: [{ 'it._id': itemId }], ...queryOptions },
    );
    if (claimed.modifiedCount === 0) return false;
    const doctorId = idOf(o.orderedBy);
    emitLabCritical(o._id.toString(), doctorId.toString());
    await notify({
      recipients: [await doctorRecipient(doctorId)],
      type: NOTIFICATION_TYPES.LAB_CRITICAL_VALUE,
      title: 'Critical lab result',
      body: 'A critical lab result needs your attention – please log in.',
      link: `/doctor/lab-orders/${o._id.toString()}`,
      email: true,
    });
    return true;
  } catch (err) {
    logger.error({ err: serializeError(err) }, 'Critical lab alert failed');
    return false;
  }
}
