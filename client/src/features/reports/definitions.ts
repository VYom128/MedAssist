import { CHART_COLORS } from '../../components/ui/chartTheme';
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from '../../constants/catalog';
import type { Role } from '../../constants/roles';
import { addDaysToDate, clinicDate, formatCalendarDate } from '../../utils/dates';
import { formatINR } from '../../utils/money';
import { formatHours, formatRate, statusColor, statusLabel } from '../dashboards/charts';
import type { ReportRow, ReportType } from './api';

/**
 * What each report shows (spec §14): its group-by choices, table columns and chart series. The
 * numbers come from the server as they are (paise, fractions, hours); these only format them.
 */

export type ValueKind = 'number' | 'money' | 'percent' | 'hours' | 'text';

export interface ReportColumn {
  key: string;
  header: string;
  kind: ValueKind;
}

export interface ChartSeries {
  key: string;
  label: string;
  color: string;
}

export interface ReportDefinition {
  type: ReportType;
  label: string;
  description: string;
  groupBys: readonly { value: string; label: string }[];
  columns: (groupBy: string) => ReportColumn[];
  chart: (groupBy: string) => {
    kind: 'line' | 'bar' | 'stacked';
    series: ChartSeries[];
    valueKind: ValueKind;
  };
}

const APPOINTMENT_STATUS_KEYS = [
  'scheduled',
  'checked_in',
  'in_consultation',
  'completed',
  'no_show',
  'cancelled',
] as const;

const firstColumn = (groupBy: string): ReportColumn => ({
  key: 'label',
  header:
    {
      day: 'Date',
      month: 'Month',
      doctor: 'Doctor',
      department: 'Department',
      status: 'Status',
      service: 'Item',
      method: 'Method',
      test: 'Test',
    }[groupBy] ?? 'Group',
  kind: 'text',
});

export const REPORTS: Record<ReportType, ReportDefinition> = {
  appointments: {
    type: 'appointments',
    label: 'Appointments',
    description: 'Appointments by start time, by status.',
    groupBys: [
      { value: 'day', label: 'Day' },
      { value: 'doctor', label: 'Doctor' },
      { value: 'department', label: 'Department' },
      { value: 'status', label: 'Status' },
    ],
    columns: (g) => [
      firstColumn(g),
      { key: 'total', header: 'Total', kind: 'number' },
      ...APPOINTMENT_STATUS_KEYS.map((s) => ({
        key: s,
        header: statusLabel('appointment', s),
        kind: 'number' as const,
      })),
    ],
    chart: (g) =>
      g === 'status'
        ? {
            kind: 'bar',
            valueKind: 'number',
            series: [{ key: 'total', label: 'Appointments', color: CHART_COLORS[0] }],
          }
        : {
            kind: 'stacked',
            valueKind: 'number',
            series: APPOINTMENT_STATUS_KEYS.map((s) => ({
              key: s,
              label: statusLabel('appointment', s),
              color: statusColor('appointment', s),
            })),
          },
  },
  revenue: {
    type: 'revenue',
    label: 'Revenue',
    description: 'Billed by issue date; collected = payments minus refunds, by payment date.',
    groupBys: [
      { value: 'day', label: 'Day' },
      { value: 'month', label: 'Month' },
      { value: 'service', label: 'Service' },
      { value: 'method', label: 'Payment method' },
    ],
    columns: (g) =>
      g === 'service'
        ? [
            firstColumn(g),
            { key: 'quantity', header: 'Quantity', kind: 'number' },
            { key: 'invoices', header: 'Invoices', kind: 'number' },
            { key: 'billedPaise', header: 'Billed', kind: 'money' },
          ]
        : g === 'method'
          ? [
              firstColumn(g),
              { key: 'paymentsPaise', header: 'Payments', kind: 'money' },
              { key: 'refundsPaise', header: 'Refunds', kind: 'money' },
              { key: 'netPaise', header: 'Net collected', kind: 'money' },
            ]
          : [
              firstColumn(g),
              { key: 'invoices', header: 'Invoices issued', kind: 'number' },
              { key: 'billedPaise', header: 'Billed', kind: 'money' },
              { key: 'paymentsPaise', header: 'Payments', kind: 'money' },
              { key: 'refundsPaise', header: 'Refunds', kind: 'money' },
              { key: 'netPaise', header: 'Net collected', kind: 'money' },
            ],
    chart: (g) =>
      g === 'service'
        ? {
            kind: 'bar',
            valueKind: 'money',
            series: [{ key: 'billedPaise', label: 'Billed', color: CHART_COLORS[0] }],
          }
        : g === 'method'
          ? {
              kind: 'bar',
              valueKind: 'money',
              series: [{ key: 'netPaise', label: 'Net collected', color: CHART_COLORS[0] }],
            }
          : {
              kind: 'line',
              valueKind: 'money',
              series: [
                { key: 'netPaise', label: 'Net collected', color: CHART_COLORS[0] },
                { key: 'billedPaise', label: 'Billed', color: CHART_COLORS[1] },
              ],
            },
  },
  'doctor-utilisation': {
    type: 'doctor-utilisation',
    label: 'Doctor utilisation',
    description: 'Booked minutes ÷ scheduled minutes, leave excluded.',
    groupBys: [{ value: 'doctor', label: 'Doctor' }],
    columns: (g) => [
      firstColumn(g),
      { key: 'availableMinutes', header: 'Available minutes', kind: 'number' },
      { key: 'bookedMinutes', header: 'Booked minutes', kind: 'number' },
      { key: 'utilisation', header: 'Utilisation', kind: 'percent' },
    ],
    chart: () => ({
      kind: 'bar',
      valueKind: 'percent',
      series: [{ key: 'utilisation', label: 'Utilisation', color: CHART_COLORS[0] }],
    }),
  },
  'lab-turnaround': {
    type: 'lab-turnaround',
    label: 'Lab turnaround',
    description: 'Hours from order to release, per test (released in the range).',
    groupBys: [{ value: 'test', label: 'Test' }],
    columns: (g) => [
      firstColumn(g),
      { key: 'code', header: 'Code', kind: 'text' },
      { key: 'count', header: 'Released', kind: 'number' },
      { key: 'medianHours', header: 'Median', kind: 'hours' },
      { key: 'p90Hours', header: '90th percentile', kind: 'hours' },
      { key: 'turnaroundHours', header: 'Target', kind: 'hours' },
      { key: 'overdue', header: 'Over target', kind: 'number' },
    ],
    chart: () => ({
      kind: 'bar',
      valueKind: 'hours',
      series: [
        { key: 'medianHours', label: 'Median', color: CHART_COLORS[0] },
        { key: 'p90Hours', label: '90th percentile', color: CHART_COLORS[3] },
      ],
    }),
  },
  'no-shows': {
    type: 'no-shows',
    label: 'No-shows',
    description: 'No-shows ÷ (completed + no-shows).',
    groupBys: [
      { value: 'doctor', label: 'Doctor' },
      { value: 'day', label: 'Day' },
    ],
    columns: (g) => [
      firstColumn(g),
      { key: 'completed', header: 'Completed', kind: 'number' },
      { key: 'noShow', header: 'No-shows', kind: 'number' },
      { key: 'rate', header: 'No-show rate', kind: 'percent' },
    ],
    chart: () => ({
      kind: 'bar',
      valueKind: 'percent',
      series: [{ key: 'rate', label: 'No-show rate', color: CHART_COLORS[5] }],
    }),
  },
};

/** Which reports each role sees, in tab order (revenue and utilisation: admin only). */
export const REPORTS_FOR_ROLE: Partial<Record<Role, ReportType[]>> = {
  admin: ['appointments', 'revenue', 'doctor-utilisation', 'lab-turnaround', 'no-shows'],
  receptionist: ['appointments', 'no-shows'],
  labtech: ['lab-turnaround'],
};

const NUMBER = new Intl.NumberFormat('en-IN');

/** A cell value as text: ₹ from paise, % from a fraction, hours, numbers in Indian grouping. */
export function formatValue(value: unknown, kind: ValueKind): string {
  if (value === null || value === undefined || value === '') return '—';
  switch (kind) {
    case 'money':
      return formatINR(Number(value));
    case 'percent':
      return formatRate(Number(value));
    case 'hours':
      return formatHours(Number(value));
    case 'number':
      return NUMBER.format(Number(value));
    default:
      return String(value);
  }
}

const MONTH = new Intl.DateTimeFormat('en-GB', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** The first column's text: clinic dates and months formatted, methods and statuses named. */
export function rowLabel(row: ReportRow, groupBy: string): string {
  const label = String(row.label ?? row.key ?? '');
  if (row.key === 'total') return label;
  switch (groupBy) {
    case 'day':
      return formatCalendarDate(label);
    case 'month':
      return /^\d{4}-\d{2}$/.test(label) ? MONTH.format(new Date(`${label}-01T12:00:00Z`)) : label;
    case 'method':
      return PAYMENT_METHOD_LABELS[label as PaymentMethod] ?? label;
    case 'status':
      return statusLabel('appointment', label);
    default:
      return label;
  }
}

// ---- Date ranges -------------------------------------------------------------------------------

export const RANGE_PRESETS = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number]['value'];

export const DEFAULT_PRESET: RangePreset = '30d';

/** A preset as clinic dates (`today` = the clinic's today). */
export function presetRange(
  preset: RangePreset,
  today = clinicDate(),
): { from: string; to: string } {
  const monthStart = `${today.slice(0, 8)}01`;
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case '7d':
      return { from: addDaysToDate(today, -6), to: today };
    case '30d':
      return { from: addDaysToDate(today, -29), to: today };
    case 'this_month':
      return { from: monthStart, to: today };
    case 'last_month': {
      const lastEnd = addDaysToDate(monthStart, -1);
      return { from: `${lastEnd.slice(0, 8)}01`, to: lastEnd };
    }
  }
}

/** The preset a range matches, if any (for highlighting the preset buttons). */
export function matchingPreset(from: string, to: string, today = clinicDate()): RangePreset | null {
  return (
    RANGE_PRESETS.find((p) => {
      const r = presetRange(p.value, today);
      return r.from === from && r.to === to;
    })?.value ?? null
  );
}
