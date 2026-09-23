import { formatDate, formatDateTime, formatInClinic, formatTime } from '../../utils/dates';
import type { Leave } from './api';

/** "05 Oct 2026" / "27 Sep 2026 – 29 Sep 2026" for whole days, else "05 Oct 2026, 2:00 PM – 6:00 PM". */
export function formatLeave(l: Leave): string {
  const wholeDays =
    formatInClinic(l.startAt, 'HH:mm') === '00:00' && formatInClinic(l.endAt, 'HH:mm') === '00:00';
  if (wholeDays) {
    const lastDay = new Date(new Date(l.endAt).getTime() - 1);
    const first = formatDate(l.startAt);
    const last = formatDate(lastDay);
    return first === last ? first : `${first} – ${last}`;
  }
  const sameDay = formatDate(l.startAt) === formatDate(l.endAt);
  return sameDay
    ? `${formatDateTime(l.startAt)} – ${formatTime(l.endAt)}`
    : `${formatDateTime(l.startAt)} – ${formatDateTime(l.endAt)}`;
}
