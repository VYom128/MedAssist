/**
 * Fallback clinic timezone (spec §3.7) until the public settings have loaded. The live value comes
 * from `GET /settings/public` (see utils/clinicTimezone.ts).
 */
export const CLINIC_TIMEZONE = 'Asia/Kolkata';
