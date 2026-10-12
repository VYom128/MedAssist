import { Patient } from '../../patients/model.js';
import { inRange, type ClinicRange } from './range.js';

/** New patients (spec §14): records created in the range. */
export function newPatients(r: ClinicRange): Promise<number> {
  return Patient.countDocuments(inRange('createdAt', r));
}
