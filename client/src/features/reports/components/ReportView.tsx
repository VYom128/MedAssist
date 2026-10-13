import { CalendarRange } from 'lucide-react';
import Alert from '../../../components/ui/Alert';
import ChartCard from '../../../components/ui/ChartCard';
import ErrorState from '../../../components/ui/ErrorState';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import Table, { type Column } from '../../../components/ui/Table';
import EmptyState from '../../../components/ui/EmptyState';
import { formatINR } from '../../../utils/money';
import { isApiQueryError } from '../../../utils/http';
import { useGetReportQuery, type ReportParams, type ReportRow } from '../api';
import { REPORTS, formatValue, rowLabel } from '../definitions';
import ReportChart from './ReportChart';

/** A row with any non-zero number (empty days still show in the table, not as "no data"). */
const hasData = (rows: ReportRow[]) =>
  rows.some((r) =>
    Object.entries(r).some(([k, v]) => k !== 'key' && typeof v === 'number' && v !== 0),
  );

/**
 * One report for a range: its chart, then the table with a totals row. A range the server
 * refuses (over 366 days → 422) shows its message as a notice, not as a failure.
 */
export default function ReportView({ params }: { params: ReportParams }) {
  const def = REPORTS[params.type];
  const { data, isLoading, isFetching, isError, error, refetch } = useGetReportQuery(params);
  const groupBy = data?.meta.groupBy ?? params.groupBy ?? def.groupBys[0]!.value;
  const columns = def.columns(groupBy);
  const chart = def.chart(groupBy);

  if (isLoading) return <ListSkeleton label={`Loading ${def.label} report…`} rows={6} />;
  if (isError) {
    if (isApiQueryError(error) && (error.status === 422 || error.code === 'VALIDATION_ERROR')) {
      return (
        <Alert tone="warning" title="Choose a shorter date range">
          <p>{error.message}</p>
          <p className="mt-1">Reports cover at most 366 days. Try a preset or narrow the dates.</p>
        </Alert>
      );
    }
    return <ErrorState error={error} onRetry={() => void refetch()} />;
  }
  if (!data) return null;
  if (data.rows.length === 0 || !hasData(data.rows)) {
    return (
      <EmptyState
        icon={CalendarRange}
        title="Nothing in this range"
        description="Try a longer date range or another grouping."
      />
    );
  }

  const named = data.rows.map((r) => ({ ...r, name: rowLabel(r, groupBy) }));
  const tableColumns: Column<ReportRow>[] = columns.map((c, i) => ({
    key: c.key,
    header: c.header,
    className: i === 0 ? 'font-medium text-ink' : 'tabular text-right',
    cell: (row) => (c.key === 'label' ? rowLabel(row, groupBy) : formatValue(row[c.key], c.kind)),
  }));
  const totals = data.totals;
  const summary = columns
    .filter((c) => c.kind !== 'text' && totals[c.key] !== null && totals[c.key] !== undefined)
    .map((c) => `${c.header}: ${formatValue(totals[c.key], c.kind)}`)
    .join(', ');
  const outstanding = typeof totals.outstandingPaise === 'number' ? totals.outstandingPaise : null;

  return (
    <div
      className={`space-y-4 transition-opacity duration-150 ease-standard ${isFetching ? 'opacity-70' : ''}`}
    >
      <div className="print-section">
        <ChartCard
          title={def.label}
          description={def.description}
          height="h-72"
          summary={`Totals – ${summary}.`}
        >
          <ReportChart
            kind={chart.kind}
            series={chart.series}
            valueKind={chart.valueKind}
            rows={named}
          />
        </ChartCard>
      </div>
      <div className="print-section space-y-3">
        <Table
          caption={`${def.label} report`}
          columns={tableColumns}
          rows={data.rows}
          rowKey={(r) => r.key}
          footerRow={{ ...totals, key: 'total', label: String(totals.label ?? 'Total') }}
        />
        {outstanding !== null && (
          <p className="text-sm text-muted">
            Outstanding now (all unpaid invoices):{' '}
            <span className="tabular font-semibold text-ink">{formatINR(outstanding)}</span>
          </p>
        )}
      </div>
    </div>
  );
}
