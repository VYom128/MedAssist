import { apiSlice } from '../../app/apiSlice';
import type { ApiSuccess } from '../../utils/http';

/**
 * Reports (spec §7.18, server modules/reports): rows + a totals row, money in paise, rates as
 * fractions, clinic dates. The CSV of the same report is downloaded as a file (useDownload),
 * never through this cache.
 */

export const REPORT_TYPES = [
  'appointments',
  'revenue',
  'doctor-utilisation',
  'lab-turnaround',
  'no-shows',
] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export type ReportRow = Record<string, unknown> & { key: string; label: string };

export interface ReportParams {
  type: ReportType;
  from: string;
  to: string;
  groupBy?: string;
}

export interface ReportResult {
  rows: ReportRow[];
  totals: ReportRow;
  meta: {
    type: ReportType;
    from: string;
    to: string;
    groupBy: string;
    timezone: string;
    generatedAt: string;
  };
}

/** Query string of a report (also used for the CSV link). */
export const reportQuery = ({ from, to, groupBy }: Omit<ReportParams, 'type'>) =>
  new URLSearchParams({ from, to, ...(groupBy ? { groupBy } : {}) }).toString();

export const reportsApi = apiSlice.injectEndpoints({
  endpoints: (build) => ({
    getReport: build.query<ReportResult, ReportParams>({
      query: ({ type, ...rest }) => ({ url: `/reports/${type}?${reportQuery(rest)}` }),
      transformResponse: (res: ApiSuccess<Pick<ReportResult, 'rows' | 'totals'>>) => ({
        ...res.data,
        meta: res.meta as unknown as ReportResult['meta'],
      }),
      providesTags: (_r, _e, { type }) => [{ type: 'Report', id: type }],
    }),
  }),
});

export const { useGetReportQuery } = reportsApi;
