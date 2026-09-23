import { CLINIC_TIMEZONE } from '../constants/clinic';

let current = CLINIC_TIMEZONE;

/**
 * The clinic timezone used to show and enter dates. Set from the public settings when they load
 * (features/settings/api.ts); the fallback is Asia/Kolkata.
 */
export const getClinicTimezone = () => current;

export function setClinicTimezone(timezone: string) {
  current = timezone;
}
