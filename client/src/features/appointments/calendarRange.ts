import { addDaysToDate } from '../../utils/dates';

/** Monday of the week containing `date` ('YYYY-MM-DD'). */
export const mondayOf = (date: string) => {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return addDaysToDate(date, -((weekday + 6) % 7));
};

/** The clinic dates a calendar shows: one day, or Monday–Sunday of the week. */
export function calendarRange(mode: 'day' | 'week', date: string) {
  const from = mode === 'week' ? mondayOf(date) : date;
  const to = mode === 'week' ? addDaysToDate(from, 6) : date;
  const days =
    mode === 'week' ? Array.from({ length: 7 }, (_, i) => addDaysToDate(from, i)) : [from];
  return { from, to, days };
}
