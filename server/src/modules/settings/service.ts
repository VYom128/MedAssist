import { AUDIT_ACTIONS, SETTINGS_CACHE_TTL_MS } from '../../config/constants.js';
import * as audit from '../../services/audit.service.js';
import type { AuthUser } from '../../types/express.js';
import { actorOf, type RequestMeta } from '../../utils/requestContext.js';
import { ClinicSettings, DEFAULT_TIMEZONE, SETTINGS_KEY } from './model.js';
import { toAdminView, toPublicView, type SettingsLike } from './serializer.js';
import type { UpdateSettingsInput } from './validation.js';

/**
 * Clinic settings (spec §6.5, §7.4): one document, cached in memory. The cache is replaced after
 * every update on this instance; the TTL lets other API instances pick up changes too.
 */

let cache: { value: SettingsLike; loadedAt: number } | null = null;

/** Loads the settings document, creating it with the §6.5 defaults if it does not exist yet. */
async function load(): Promise<SettingsLike> {
  // Read first: an upserting update would bump updatedAt (timestamps) on every load.
  const existing = await ClinicSettings.findOne({ key: SETTINGS_KEY }).lean();
  if (existing) return existing as SettingsLike;
  const doc = await ClinicSettings.findOneAndUpdate(
    { key: SETTINGS_KEY },
    { $setOnInsert: { key: SETTINGS_KEY } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();
  return doc as SettingsLike;
}

/** The clinic settings (cached). Other services read timezone, rules and toggles from here. */
export async function getSettings(): Promise<SettingsLike> {
  if (cache && Date.now() - cache.loadedAt < SETTINGS_CACHE_TTL_MS) return cache.value;
  const value = await load();
  cache = { value, loadedAt: Date.now() };
  return value;
}

/**
 * The clinic timezone from the cache, without I/O (for synchronous code such as model virtuals).
 * Falls back to the settings default before the settings have been loaded.
 */
export function cachedTimezone(): string {
  return cache?.value.timezone ?? DEFAULT_TIMEZONE;
}

/** Drops the cache (tests and the seed, after writing settings directly). */
export function clearSettingsCache(): void {
  cache = null;
}

export async function getPublicSettings() {
  return toPublicView(await getSettings());
}

export async function getAdminSettings() {
  return toAdminView(await getSettings());
}

type Flat = Record<string, unknown>;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);

/** { appointment: { minCancelHours: 4 } } → { 'appointment.minCancelHours': 4 }. Arrays are leaves. */
function flatten(value: Record<string, unknown>, prefix = ''): Flat {
  const out: Flat = {};
  for (const [key, v] of Object.entries(value)) {
    if (v === undefined) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(v)) Object.assign(out, flatten(v, path));
    else out[path] = v;
  }
  return out;
}

const valueAt = (source: unknown, path: string) =>
  path.split('.').reduce<unknown>((v, k) => (isPlainObject(v) ? v[k] : undefined), source);

/**
 * PATCH /settings – deep partial update. Audits `settings.update` with before/after of the
 * changed fields only (dotted paths, e.g. `appointment.minCancelHours`) and refreshes the cache.
 */
export async function updateSettings(
  admin: AuthUser,
  patch: UpdateSettingsInput,
  meta: RequestMeta,
) {
  const before = await load();
  const set = flatten(patch as Record<string, unknown>);
  const paths = Object.keys(set);
  const beforeFlat = Object.fromEntries(paths.map((p) => [p, valueAt(before, p) ?? null]));
  const changes = audit.diffChanges(beforeFlat, set, paths);
  if (changes.fields.length === 0) {
    cache = { value: before, loadedAt: Date.now() };
    return toAdminView(before);
  }

  const toSet = Object.fromEntries(changes.fields.map((p) => [p, set[p]]));
  const updated = (await ClinicSettings.findOneAndUpdate(
    { key: SETTINGS_KEY },
    { $set: { ...toSet, updatedBy: admin.id } },
    { new: true, runValidators: true },
  ).lean()) as SettingsLike;
  cache = { value: updated, loadedAt: Date.now() };

  await audit.record({
    action: AUDIT_ACTIONS.SETTINGS_UPDATE,
    actor: actorOf(admin),
    resource: { type: 'settings', id: updated._id },
    request: meta,
    changes,
  });
  return toAdminView(updated);
}
