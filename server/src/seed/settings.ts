import { getAdminSettings, updateSettings } from '../modules/settings/service.js';
import { updateSettingsSchema } from '../modules/settings/validation.js';
import { changed, counts, SEED_REQUEST, seedActor, type SeedCounts } from './context.js';
import { CLINIC_SETTINGS } from './data/clinic.js';

/** Clinic settings through the settings service (only changed fields are written and audited). */
export async function seedSettings(): Promise<SeedCounts> {
  const actor = await seedActor();
  const result = counts();
  const before = await getAdminSettings();
  const after = await updateSettings(
    actor,
    updateSettingsSchema.body.parse(CLINIC_SETTINGS),
    SEED_REQUEST,
  );
  if (changed(before, after)) result.updated += 1;
  else result.unchanged += 1;
  return result;
}
