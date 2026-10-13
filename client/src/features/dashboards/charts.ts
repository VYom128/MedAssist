import { CHART_COLORS } from '../../components/ui/chartTheme';
import { STATUS_STYLES, type Tone } from '../../components/ui/statusStyles';
import { APPOINTMENT_STATUSES, type AppointmentStatus } from '../../constants/catalog';
import { formatINR } from '../../utils/money';

/** Chart colour of each tone (same order as CHART_COLORS: primary, info, success, …). */
const TONE_COLOR: Record<Tone, string> = {
  primary: CHART_COLORS[0],
  info: CHART_COLORS[1],
  success: CHART_COLORS[2],
  warning: CHART_COLORS[3],
  consult: CHART_COLORS[4],
  danger: CHART_COLORS[5],
  neutral: CHART_COLORS[6],
};

/** A status's chart colour, from its tone in the central status map (spec §13.3 colours). */
export function statusColor(domain: 'appointment' | 'labOrder', status: string): string {
  const style = (STATUS_STYLES[domain] as Record<string, { tone: Tone }>)[status];
  return TONE_COLOR[style?.tone ?? 'neutral'];
}

export const statusLabel = (domain: 'appointment' | 'labOrder', status: string): string =>
  (STATUS_STYLES[domain] as Record<string, { label: string }>)[status]?.label ?? status;

export interface Slice {
  key: string;
  label: string;
  value: number;
  color: string;
}

/** Appointment counts as chart slices in lifecycle order (zero counts kept for the legend). */
export function appointmentSlices(counts: Record<AppointmentStatus, number>): Slice[] {
  return APPOINTMENT_STATUSES.map((s) => ({
    key: s,
    label: statusLabel('appointment', s),
    value: counts[s] ?? 0,
    color: statusColor('appointment', s),
  }));
}

/** "Scheduled 4, Completed 2, …" – the text alternative of a status chart. */
export const slicesSummary = (slices: Slice[]) =>
  slices
    .filter((s) => s.value > 0)
    .map((s) => `${s.label} ${s.value}`)
    .join(', ');

/** 0.1234 → "12.3%"; null (nothing to divide) → "—". */
export function formatRate(rate: number | null | undefined, digits = 1): string {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) return '—';
  return `${(rate * 100).toFixed(digits)}%`;
}

/** Hours with one decimal, "—" when there is no value. */
export const formatHours = (h: number | null | undefined) =>
  h === null || h === undefined ? '—' : `${h.toFixed(1)} h`;

/** Short rupee amounts for chart axes: ₹950, ₹12.5k, ₹3.2L, ₹1.1Cr (from paise). */
export function compactINR(paise: number): string {
  const r = paise / 100;
  const abs = Math.abs(r);
  const trim = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  if (abs >= 1e7) return `₹${trim(r / 1e7)}Cr`;
  if (abs >= 1e5) return `₹${trim(r / 1e5)}L`;
  if (abs >= 1e3) return `₹${trim(r / 1e3)}k`;
  return formatINR(paise).replace(/\.00$/, '');
}

/**
 * Change against a previous value for a StatCard trend: "+12% vs last month". Nothing when
 * there is no previous value to compare with.
 */
export function changeVs(
  current: number,
  previous: number,
  label: string,
  higherIsGood = true,
):
  | {
      direction: 'up' | 'down' | 'flat';
      label: string;
      sentiment: 'positive' | 'negative' | 'neutral';
    }
  | undefined {
  if (!previous) return undefined;
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return { direction: 'flat', label: `No change vs ${label}`, sentiment: 'neutral' };
  const up = pct > 0;
  return {
    direction: up ? 'up' : 'down',
    label: `${up ? '+' : ''}${pct}% vs ${label}`,
    sentiment: up === higherIsGood ? 'positive' : 'negative',
  };
}
