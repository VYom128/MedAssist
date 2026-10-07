import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ROLES } from '../config/constants.js';
import { Document } from '../modules/documents/model.js';
import { uploadDocument } from '../modules/documents/service.js';
import { uploadDocumentSchema } from '../modules/documents/validation.js';
import { User } from '../modules/users/model.js';
import type { AuthUser } from '../types/express.js';
import { SEED_REQUEST, seedActor } from './context.js';

/**
 * A few uploaded documents (spec §15.3), through the documents service (type check, checksum,
 * storage, audit) from the small sample files in seed/files: patient1's own referral letter and
 * their ID proof and patient2's insurance card, both uploaded by reception1. Skipped when a
 * document with the same title already exists for the patient.
 */
const file = (name: string) => fileURLToPath(new URL(`./files/${name}`, import.meta.url));

export async function patientActor(email: string): Promise<AuthUser & { patientId: string }> {
  const u = await User.findOne({ email, role: ROLES.PATIENT }).lean();
  if (!u?.patient) throw new Error(`Seed patient ${email} is missing`);
  return {
    id: u._id.toString(),
    role: ROLES.PATIENT,
    sessionId: 'seed',
    sessionFamily: 'seed',
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email,
    mustChangePassword: false,
    patientId: u.patient.toString(),
  };
}

export async function seedDocuments(): Promise<Record<string, number>> {
  const reception = await seedActor('reception1@medassist.dev', ROLES.RECEPTIONIST);
  const patient1 = await patientActor('patient1@medassist.dev');
  const patient2 = await patientActor('patient2@medassist.dev');
  const docs = [
    {
      by: patient1,
      patientId: patient1.patientId,
      category: 'referral',
      title: 'Referral letter from City Heart Centre',
      name: 'referral-letter.pdf',
    },
    {
      by: reception,
      patientId: patient1.patientId,
      category: 'id_proof',
      title: 'Aadhaar card (demo)',
      name: 'id-proof.png',
    },
    {
      by: reception,
      patientId: patient2.patientId,
      category: 'insurance',
      title: 'Health insurance card (demo)',
      name: 'id-proof.png',
    },
  ];
  const result = { created: 0, unchanged: 0 };
  for (const d of docs) {
    if (await Document.exists({ patient: d.patientId, title: d.title, isDeleted: false })) {
      result.unchanged += 1;
      continue;
    }
    const buffer = await readFile(file(d.name));
    const input = uploadDocumentSchema.body.parse({
      patientId: d.patientId,
      category: d.category,
      title: d.title,
    });
    await uploadDocument(
      d.by,
      { buffer, size: buffer.length, originalname: d.name },
      input,
      SEED_REQUEST,
    );
    result.created += 1;
  }
  return result;
}
