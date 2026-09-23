import { fileURLToPath } from 'node:url';
import type { Types } from 'mongoose';
import { AUDIT_ACTIONS, ROLES } from '../config/constants.js';
import { connectDB, disconnectDB } from '../config/db.js';
import { config } from '../config/env.js';
import { Patient } from '../modules/patients/model.js';
import { insertPatient } from '../modules/patients/service.js';
import { User } from '../modules/users/model.js';
import * as audit from '../services/audit.service.js';
import { calendarDateString, isValidDateOfBirth } from '../utils/dates.js';
import { logger, serializeError } from '../utils/logger.js';
import { tryNormalisePhone } from '../utils/phone.js';
import { withTransaction } from '../utils/transaction.js';

/**
 * `npm run migrate:link-patients` (dev/test only) – patient users created before Phase 3 have no
 * Patient record. For each one with a name, a valid phone and a date of birth, this creates a
 * Patient and links it; users missing any of these are listed instead of guessed. Pending
 * self-sign-ups (waiting for reception) are left alone. Running it again changes nothing.
 */

export interface MigrationResult {
  linked: { userId: string; email: string; mrn: string }[];
  skipped: { userId: string; email: string; missing: string[] }[];
}

/** Patient users without a usable link: no `patient`, or one pointing at a missing record. */
async function unlinkedPatientUsers() {
  const users = await User.find({
    role: ROLES.PATIENT,
    patientLinkStatus: { $ne: 'pending_verification' },
  }).lean();
  const pointed = users.filter((u) => u.patient).map((u) => u.patient!);
  const existing = new Set(
    (await Patient.find({ _id: { $in: pointed } }, { _id: 1 }).lean()).map((p) => p._id.toString()),
  );
  return users.filter((u) => !u.patient || !existing.has(u.patient.toString()));
}

export async function migrateLinkPatients(): Promise<MigrationResult> {
  if (config.isProd) throw new Error('Refusing to run with NODE_ENV=production');
  const result: MigrationResult = { linked: [], skipped: [] };

  for (const user of await unlinkedPatientUsers()) {
    const phone = user.phone ? tryNormalisePhone(user.phone) : null;
    const dob =
      user.dateOfBirth && isValidDateOfBirth(calendarDateString(user.dateOfBirth))
        ? user.dateOfBirth
        : null;
    const missing = [
      ...(user.firstName && user.lastName ? [] : ['name']),
      ...(phone ? [] : ['phone']),
      ...(dob ? [] : ['dateOfBirth']),
    ];
    if (missing.length > 0) {
      result.skipped.push({ userId: user._id.toString(), email: user.email, missing });
      continue;
    }

    const patient = await withTransaction(async (session) => {
      const created = await insertPatient(
        {
          firstName: user.firstName,
          lastName: user.lastName,
          dateOfBirth: dob,
          gender: 'unknown',
          phone,
          email: user.email,
          consent: {
            dataProcessing: {
              given: Boolean(user.termsAcceptedAt),
              at: user.termsAcceptedAt ?? null,
            },
          },
          user: user._id,
          registeredBy: user._id,
        } as never,
        { session },
      );
      await User.updateOne(
        { _id: user._id },
        { $set: { patient: created._id, patientLinkStatus: 'linked', phone } },
        { session },
      );
      return created;
    });
    await audit.record({
      action: AUDIT_ACTIONS.PATIENT_CREATE,
      actor: null, // system
      resource: { type: 'patient', id: patient._id, number: patient.mrn },
      patient: patient._id as Types.ObjectId,
      metadata: { source: 'migration:link-patients', userId: user._id.toString() },
    });
    result.linked.push({ userId: user._id.toString(), email: user.email, mrn: patient.mrn });
  }
  await audit.flushAudit();
  return result;
}

async function main() {
  await connectDB();
  try {
    const { linked, skipped } = await migrateLinkPatients();
    logger.info(`Linked ${linked.length} patient user(s) to new patient records`);
    // User ids and MRNs only: no patient details in logs.
    for (const l of linked) logger.info(`  user ${l.userId} → ${l.mrn}`);
    if (skipped.length > 0) {
      logger.warn(`Skipped ${skipped.length} user(s) with missing data (link them by hand):`);
      for (const s of skipped) logger.warn(`  user ${s.userId}: missing ${s.missing.join(', ')}`);
    }
  } finally {
    await disconnectDB();
  }
}

// Run only when executed directly, not when imported by tests.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    logger.fatal({ err: serializeError(err) }, 'Migration failed');
    process.exit(1);
  });
}
