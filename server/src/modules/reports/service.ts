import {
  AUDIT_ACTIONS,
  ERROR_CODES,
  REPORT_RULES,
  type ReportType,
} from '../../config/constants.js';
import * as audit from '../../services/audit.service.js';
import type { AuthUser } from '../../types/express.js';
import { ApiError } from '../../utils/ApiError.js';
import { actorOf, type RequestMeta } from '../../utils/requestContext.js';
import { getSettings } from '../settings/service.js';
import type { CsvColumn } from './csv.js';
import {
  appointmentsGrouped,
  billed,
  clinicRange,
  collectedRevenue,
  datesIn,
  doctorUtilisation,
  labTurnaround,
  monthsIn,
  noShowRate,
  noShowsByDoctor,
  outstanding,
  rangeDays,
  ratio,
  type AppointmentGroupBy,
  type ClinicRange,
} from './metrics/index.js';
import type { ReportQuery } from './validation.js';

/**
 * Reports (spec §7.18, §14, Phase 10): JSON `{ rows, totals, meta }` for the screen or a CSV
 * download with the same rows. Every number comes from the shared metrics module (the
 * dashboards use the same functions). Ranges are clinic dates, at most 366 days (422). A CSV
 * export is audited as `report.export` with the type, range and format – never row data.
 */

export interface Report<Row> {
  rows: Row[];
  totals: Row;
  columns: CsvColumn<Row>[];
  groupBy: string;
}

type Built = Report<Record<string, unknown>>;

const label = (header: string, key = 'label') => ({
  header,
  value: (r: Record<string, unknown>) => r[key],
});
const num = (header: string, key: string) => ({
  header,
  kind: 'number' as const,
  value: (r: Record<string, unknown>) => r[key],
});
const money = (header: string, key: string) => ({
  header,
  kind: 'money' as const,
  value: (r: Record<string, unknown>) => r[key],
});
const pct = (header: string, key: string) => ({
  header,
  kind: 'percent' as const,
  value: (r: Record<string, unknown>) => r[key],
});

const sum = (rows: Record<string, unknown>[], key: string) =>
  rows.reduce((s, r) => s + (Number(r[key]) || 0), 0);

// ---- Appointments ------------------------------------------------------------------------------

async function appointmentsReport(r: ClinicRange, groupBy: AppointmentGroupBy): Promise<Built> {
  const rows = (await appointmentsGrouped(r, groupBy)) as unknown as Record<string, unknown>[];
  const filled =
    groupBy === 'day'
      ? datesIn(r.from, r.to).map(
          (d) =>
            rows.find((x) => x.key === d) ?? {
              key: d,
              label: d,
              total: 0,
              scheduled: 0,
              checked_in: 0,
              in_consultation: 0,
              completed: 0,
              cancelled: 0,
              no_show: 0,
            },
        )
      : rows;
  const keys = [
    'total',
    'scheduled',
    'checked_in',
    'in_consultation',
    'completed',
    'cancelled',
    'no_show',
  ];
  const totals: Record<string, unknown> = { key: 'total', label: 'Total' };
  for (const k of keys) totals[k] = sum(filled, k);
  return {
    groupBy,
    rows: filled,
    totals,
    columns: [
      label(
        groupBy === 'day'
          ? 'Date'
          : groupBy === 'doctor'
            ? 'Doctor'
            : groupBy === 'department'
              ? 'Department'
              : 'Status',
      ),
      num('Total', 'total'),
      num('Scheduled', 'scheduled'),
      num('Checked in', 'checked_in'),
      num('In consultation', 'in_consultation'),
      num('Completed', 'completed'),
      num('Cancelled', 'cancelled'),
      num('No-show', 'no_show'),
    ],
  };
}

// ---- Revenue (admin) ---------------------------------------------------------------------------

type RevenueGroupBy = 'day' | 'month' | 'service' | 'method';

async function revenueReport(r: ClinicRange, groupBy: RevenueGroupBy): Promise<Built> {
  const owed = await outstanding();
  if (groupBy === 'service') {
    const rows = (await billed(r, 'service')).map((x) => ({ ...x })) as Record<string, unknown>[];
    return {
      groupBy,
      rows,
      totals: {
        key: 'total',
        label: 'Total',
        quantity: sum(rows, 'quantity'),
        invoices: null,
        billedPaise: sum(rows, 'billedPaise'),
        outstandingPaise: owed.balancePaise,
      },
      columns: [
        label('Item'),
        num('Quantity', 'quantity'),
        num('Invoices', 'invoices'),
        money('Billed (₹)', 'billedPaise'),
      ],
    };
  }
  if (groupBy === 'method') {
    const rows = (await collectedRevenue(r, 'method')).map((x) => ({
      ...x,
      label: x.key,
    })) as Record<string, unknown>[];
    return {
      groupBy,
      rows,
      totals: {
        key: 'total',
        label: 'Total',
        paymentsPaise: sum(rows, 'paymentsPaise'),
        refundsPaise: sum(rows, 'refundsPaise'),
        netPaise: sum(rows, 'netPaise'),
        outstandingPaise: owed.balancePaise,
      },
      columns: [
        label('Method'),
        money('Payments (₹)', 'paymentsPaise'),
        money('Refunds (₹)', 'refundsPaise'),
        money('Net collected (₹)', 'netPaise'),
      ],
    };
  }
  const [b, c] = await Promise.all([billed(r, groupBy), collectedRevenue(r, groupBy)]);
  const keys = groupBy === 'day' ? datesIn(r.from, r.to) : monthsIn(r.from, r.to);
  const rows = keys.map((k) => {
    const bx = b.find((x) => x.key === k);
    const cx = c.find((x) => x.key === k);
    return {
      key: k,
      label: k,
      invoices: bx?.invoices ?? 0,
      billedPaise: bx?.billedPaise ?? 0,
      paymentsPaise: cx?.paymentsPaise ?? 0,
      refundsPaise: cx?.refundsPaise ?? 0,
      netPaise: cx?.netPaise ?? 0,
    };
  });
  return {
    groupBy,
    rows,
    totals: {
      key: 'total',
      label: 'Total',
      invoices: sum(rows, 'invoices'),
      billedPaise: sum(rows, 'billedPaise'),
      paymentsPaise: sum(rows, 'paymentsPaise'),
      refundsPaise: sum(rows, 'refundsPaise'),
      netPaise: sum(rows, 'netPaise'),
      outstandingPaise: owed.balancePaise,
    },
    columns: [
      label(groupBy === 'day' ? 'Date' : 'Month'),
      num('Invoices issued', 'invoices'),
      money('Billed (₹)', 'billedPaise'),
      money('Payments (₹)', 'paymentsPaise'),
      money('Refunds (₹)', 'refundsPaise'),
      money('Net collected (₹)', 'netPaise'),
    ],
  };
}

// ---- Doctor utilisation (admin) ----------------------------------------------------------------

async function utilisationReport(r: ClinicRange): Promise<Built> {
  const rows = (await doctorUtilisation(r)).map((x) => ({
    ...x,
    key: x.doctorId,
    label: x.doctorName,
  }));
  const available = sum(rows, 'availableMinutes');
  const booked = sum(rows, 'bookedMinutes');
  return {
    groupBy: 'doctor',
    rows,
    totals: {
      key: 'total',
      label: 'Total',
      availableMinutes: available,
      bookedMinutes: booked,
      utilisation: ratio(booked, available),
    },
    columns: [
      label('Doctor'),
      num('Available minutes', 'availableMinutes'),
      num('Booked minutes', 'bookedMinutes'),
      pct('Utilisation (%)', 'utilisation'),
    ],
  };
}

// ---- Lab turnaround (admin, lab) ---------------------------------------------------------------

async function labTatReport(r: ClinicRange): Promise<Built> {
  const { rows, overall } = await labTurnaround(r);
  return {
    groupBy: 'test',
    rows: rows.map((x) => ({ ...x, key: x.code, label: x.name })),
    totals: { key: 'total', label: 'All tests', code: null, turnaroundHours: null, ...overall },
    columns: [
      label('Test'),
      { header: 'Code', value: (x) => x.code },
      num('Released', 'count'),
      num('Median hours', 'medianHours'),
      num('90th percentile hours', 'p90Hours'),
      num('Turnaround target hours', 'turnaroundHours'),
      num('Over target', 'overdue'),
    ],
  };
}

// ---- No-shows (admin, reception) ---------------------------------------------------------------

async function noShowReport(r: ClinicRange, groupBy: 'doctor' | 'day'): Promise<Built> {
  const now = new Date();
  let rows: Record<string, unknown>[];
  if (groupBy === 'doctor') {
    rows = await noShowsByDoctor(r, now);
  } else {
    const days = datesIn(r.from, r.to);
    const { timezone } = r;
    rows = await Promise.all(
      days.map(async (d) => {
        const x = await noShowRate(clinicRange(d, d, timezone), {}, now);
        return { key: d, label: d, ...x };
      }),
    );
  }
  const overall = await noShowRate(r, {}, now);
  return {
    groupBy,
    rows,
    totals: { key: 'total', label: 'Total', ...overall },
    columns: [
      label(groupBy === 'doctor' ? 'Doctor' : 'Date'),
      num('Completed', 'completed'),
      num('No-shows', 'noShow'),
      pct('No-show rate (%)', 'rate'),
    ],
  };
}

const DEFAULT_GROUP_BY: Record<ReportType, string> = {
  appointments: 'day',
  revenue: 'day',
  'doctor-utilisation': 'doctor',
  'lab-turnaround': 'test',
  'no-shows': 'doctor',
};

/** Builds a report for the range; 422 VALIDATION_ERROR beyond 366 days. */
export async function buildReport(type: ReportType, query: ReportQuery) {
  const { timezone } = await getSettings();
  const r = clinicRange(query.from, query.to, timezone);
  if (rangeDays(r) > REPORT_RULES.maxRangeDays) {
    throw new ApiError(
      422,
      `Choose at most ${REPORT_RULES.maxRangeDays} days`,
      ERROR_CODES.VALIDATION_ERROR,
      [{ field: 'query.to', message: `At most ${REPORT_RULES.maxRangeDays} days after "from"` }],
    );
  }
  const groupBy = query.groupBy ?? DEFAULT_GROUP_BY[type];
  let built: Built;
  switch (type) {
    case 'appointments':
      built = await appointmentsReport(r, groupBy as AppointmentGroupBy);
      break;
    case 'revenue':
      built = await revenueReport(r, groupBy as RevenueGroupBy);
      break;
    case 'doctor-utilisation':
      built = await utilisationReport(r);
      break;
    case 'lab-turnaround':
      built = await labTatReport(r);
      break;
    case 'no-shows':
      built = await noShowReport(r, groupBy as 'doctor' | 'day');
      break;
  }
  return {
    ...built,
    meta: {
      type,
      from: r.from,
      to: r.to,
      groupBy: built.groupBy,
      timezone,
      generatedAt: new Date().toISOString(),
    },
  };
}

/** `report.export` – who exported which report for which range (no row data). */
export async function auditExport(
  user: AuthUser,
  type: ReportType,
  query: ReportQuery,
  groupBy: string,
  rows: number,
  meta: RequestMeta,
) {
  await audit.record({
    action: AUDIT_ACTIONS.REPORT_EXPORT,
    actor: actorOf(user),
    resource: { type: 'report' },
    request: meta,
    metadata: { report: type, from: query.from, to: query.to, groupBy, format: 'csv', rows },
  });
}

export const reportFileName = (type: ReportType, from: string, to: string) =>
  `medassist-${type}-${from}-${to}.csv`;
