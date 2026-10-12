import { z } from 'zod';
import { dateOnly } from '../../utils/zod.js';

/**
 * Report queries (spec §7.18): `from`, `to` (clinic dates, from ≤ to), `groupBy` (per report)
 * and `format=json|csv`. The 366-day limit is checked in the service (422).
 */
const reportQuery = <G extends [string, ...string[]]>(groupBys: G) => ({
  query: z
    .object({
      from: dateOnly,
      to: dateOnly,
      groupBy: z.enum(groupBys).optional(),
      format: z.enum(['json', 'csv']).default('json'),
    })
    .refine((q) => q.from <= q.to, { message: '"to" must not be before "from"', path: ['to'] }),
});

export const appointmentsReportSchema = reportQuery(['day', 'doctor', 'department', 'status']);
export const revenueReportSchema = reportQuery(['day', 'month', 'service', 'method']);
export const utilisationReportSchema = reportQuery(['doctor']);
export const labTatReportSchema = reportQuery(['test']);
export const noShowsReportSchema = reportQuery(['doctor', 'day']);

export interface ReportQuery {
  from: string;
  to: string;
  groupBy?: string;
  format: 'json' | 'csv';
}
