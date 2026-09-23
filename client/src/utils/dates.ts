import { CLINIC_TIMEZONE } from '../constants/clinic';

/** "23 Sept 2026, 5:30 pm" in the clinic timezone. */
export function formatDateTime(iso: string | null | undefined, timeZone = CLINIC_TIMEZONE): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(iso));
}

/** UTC offset like "+05:30" of `timeZone` at `date`. */
export function timeZoneOffset(date: Date, timeZone = CLINIC_TIMEZONE): string {
  const name =
    new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
      .formatToParts(date)
      .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  return name === 'GMT' ? '+00:00' : name.slice(3);
}

/**
 * ISO date-time with offset for the start or end of a clinic-timezone day (`YYYY-MM-DD`), for
 * `from` / `to` filters.
 */
export function clinicDayBoundary(day: string, edge: 'start' | 'end', timeZone = CLINIC_TIMEZONE) {
  const offset = timeZoneOffset(new Date(`${day}T12:00:00Z`), timeZone);
  return `${day}T${edge === 'start' ? '00:00:00.000' : '23:59:59.999'}${offset}`;
}
