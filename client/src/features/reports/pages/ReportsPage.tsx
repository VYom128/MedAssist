import { FileDown, Printer } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAppSelector } from '../../../app/hooks';
import Button from '../../../components/ui/Button';
import FilterChip from '../../../components/ui/FilterChip';
import Input from '../../../components/ui/Input';
import PageHeader from '../../../components/ui/PageHeader';
import Select from '../../../components/ui/Select';
import Tabs from '../../../components/ui/Tabs';
import { useDownload } from '../../../hooks/useFileTransfer';
import PrintHeader from '../../../layouts/PrintHeader';
import { formatCalendarDate } from '../../../utils/dates';
import { getQueryErrorMessage } from '../../../utils/http';
import { selectCurrentUser } from '../../auth/authSlice';
import { reportQuery, type ReportType } from '../api';
import {
  DEFAULT_PRESET,
  RANGE_PRESETS,
  REPORTS,
  REPORTS_FOR_ROLE,
  matchingPreset,
  presetRange,
} from '../definitions';
import ReportView from '../components/ReportView';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Reports (spec §7.18, §14, Phase 10) – admin: all five; reception: appointments and no-shows;
 * lab: turnaround. The report, range and grouping live in the URL (`?report=&from=&to=&groupBy=`)
 * so a view can be shared and survives a reload. "Export CSV" downloads the same report from the
 * server (audited there, named by the server); "Print" prints the chart and table with the
 * clinic header.
 */
export default function ReportsPage() {
  const user = useAppSelector(selectCurrentUser);
  const [params, setParams] = useSearchParams();
  const { download, busy } = useDownload();
  const allowed = (user && REPORTS_FOR_ROLE[user.role]) ?? [];

  const requested = params.get('report') as ReportType | null;
  const type = requested && allowed.includes(requested) ? requested : allowed[0];
  const fallback = presetRange(DEFAULT_PRESET);
  const from = params.get('from') ?? fallback.from;
  const to = params.get('to') ?? fallback.to;
  if (!type) return null;
  const def = REPORTS[type];
  const groupByParam = params.get('groupBy') ?? '';
  const groupBy = def.groupBys.some((g) => g.value === groupByParam)
    ? groupByParam
    : def.groupBys[0]!.value;

  const rangeError =
    !DATE.test(from) || !DATE.test(to)
      ? 'Enter both dates.'
      : from > to
        ? '"To" must not be before "From".'
        : null;

  const update = (changes: Record<string, string | null>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(changes)) {
          if (v) next.set(k, v);
          else next.delete(k);
        }
        return next;
      },
      { replace: true },
    );

  const preset = matchingPreset(from, to);
  const rangeText = rangeError
    ? ''
    : from === to
      ? formatCalendarDate(from)
      : `${formatCalendarDate(from)} – ${formatCalendarDate(to)}`;

  const exportCsv = () =>
    download(
      `/reports/${type}?${reportQuery({ from, to, groupBy })}&format=csv`,
      `medassist-${type}-${from}-${to}.csv`,
    )
      .then(() => toast.success('CSV downloaded'))
      .catch((err: unknown) => toast.error(getQueryErrorMessage(err)));

  return (
    <section>
      <PageHeader
        title="Reports"
        description="Clinic figures for a date range, in clinic time. Money in rupees."
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => void exportCsv()}
              loading={busy}
              disabled={Boolean(rangeError)}
            >
              <FileDown className="h-4 w-4" aria-hidden="true" /> Export CSV
            </Button>
            <Button variant="secondary" onClick={() => window.print()}>
              <Printer className="h-4 w-4" aria-hidden="true" /> Print
            </Button>
          </>
        }
      />
      <PrintHeader
        title={`${def.label} report`}
        subtitle={`${rangeText} · grouped by ${def.groupBys.find((g) => g.value === groupBy)?.label.toLowerCase() ?? groupBy}`}
      />

      <Tabs
        tabs={allowed.map((t) => ({ id: t, label: REPORTS[t].label }))}
        value={type}
        onChange={(id) => update({ report: id, groupBy: null })}
        label="Report"
      >
        <div
          role="search"
          aria-label="Report filters"
          className="mb-4 space-y-4 rounded-card border border-line bg-surface p-4 shadow-card"
        >
          <div className="flex flex-wrap gap-2" role="group" aria-label="Date range presets">
            {RANGE_PRESETS.map((p) => (
              <FilterChip
                key={p.value}
                label={p.label}
                selected={preset === p.value}
                onClick={() => update(presetRange(p.value))}
              />
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Input
              label="From"
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => update({ from: e.target.value })}
              error={rangeError ?? undefined}
            />
            <Input
              label="To"
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => update({ to: e.target.value })}
            />
            {def.groupBys.length > 1 && (
              <Select
                label="Group by"
                value={groupBy}
                options={def.groupBys}
                onChange={(e) => update({ groupBy: e.target.value })}
              />
            )}
          </div>
        </div>
        {!rangeError && <ReportView params={{ type, from, to, groupBy }} />}
      </Tabs>
    </section>
  );
}
