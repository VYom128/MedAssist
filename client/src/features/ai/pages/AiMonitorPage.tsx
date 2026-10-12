import {
  Activity,
  BadgeCheck,
  Coins,
  Gauge,
  Layers,
  Server,
  ShieldAlert,
  Sparkles,
  Timer,
  TriangleAlert,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import Badge from '../../../components/ui/Badge';
import Button from '../../../components/ui/Button';
import ChartCard from '../../../components/ui/ChartCard';
import { CHART_COLORS, CHART_THEME } from '../../../components/ui/chartTheme';
import DescriptionList from '../../../components/ui/DescriptionList';
import EmptyState from '../../../components/ui/EmptyState';
import ErrorState from '../../../components/ui/ErrorState';
import Input from '../../../components/ui/Input';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import PageHeader from '../../../components/ui/PageHeader';
import Pagination from '../../../components/ui/Pagination';
import SectionCard from '../../../components/ui/SectionCard';
import Select from '../../../components/ui/Select';
import Skeleton from '../../../components/ui/Skeleton';
import StatCard from '../../../components/ui/StatCard';
import StatusPill from '../../../components/ui/StatusPill';
import Table, { type Column } from '../../../components/ui/Table';
import {
  addDaysToDate,
  clinicDate,
  formatCalendarDate,
  formatDateTime,
} from '../../../utils/dates';
import {
  AI_FEATURES,
  AI_INTERACTION_STATUSES,
  useGetAiConfigQuery,
  useGetAiInteractionSummaryQuery,
  useListAiInteractionsQuery,
  type AiConfig,
  type AiFeature,
  type AiInteraction,
  type AiInteractionStatus,
  type AiInteractionSummary,
} from '../api';
import { flagLabel } from '../flags';

const PAGE_SIZE = 20;
const DEFAULT_DAYS = 30;

const FEATURE_LABELS: Record<AiFeature, string> = {
  clinical_summary: 'Clinical summary',
  patient_explanation: 'Patient explanation',
};
const STATUS_LABELS: Record<AiInteractionStatus, string> = {
  success: 'Success',
  failed: 'Failed',
  blocked: 'Blocked',
};

const number = new Intl.NumberFormat('en-IN');
const percent = (rate: number) => `${(rate * 100).toFixed(1)} %`;
const ms = (value: number) => (value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${value} ms`);
/** '2026-10-12' → '12 Oct' for chart axes. */
const shortDay = (date: string) => formatCalendarDate(date).replace(/ \d{4}$/, '');

/**
 * The table of recent attempts: what happened, never content. Only these fields are rendered,
 * so anything else in a row (there should be none) never reaches the screen.
 */
const columns: Column<AiInteraction>[] = [
  {
    key: 'time',
    header: 'Time',
    cell: (r) => (
      <span className="tabular whitespace-nowrap text-muted">{formatDateTime(r.createdAt)}</span>
    ),
  },
  { key: 'feature', header: 'Feature', cell: (r) => FEATURE_LABELS[r.feature] ?? r.feature },
  {
    key: 'model',
    header: 'Model',
    cell: (r) => (
      <span className="flex flex-wrap items-center gap-1.5">
        <span className="break-all">{r.model ?? '—'}</span>
        {r.isFallbackModel && <Badge tone="warning">Fallback</Badge>}
      </span>
    ),
  },
  { key: 'attempt', header: 'Attempt', cell: (r) => <span className="tabular">{r.attempt}</span> },
  {
    key: 'status',
    header: 'Status',
    cell: (r) => (
      <span className="flex flex-col gap-0.5">
        <StatusPill domain="aiInteraction" status={r.status} size="sm" />
        {r.errorReason && (
          <span className="text-xs text-muted">{r.errorReason.replace(/_/g, ' ')}</span>
        )}
      </span>
    ),
  },
  {
    key: 'flags',
    header: 'Flags',
    cell: (r) =>
      r.guardrailFlags.length ? (
        <span className="flex flex-wrap gap-1">
          {r.guardrailFlags.map((f) => (
            <Badge key={f} tone="neutral">
              {flagLabel(f)}
            </Badge>
          ))}
        </span>
      ) : (
        <span className="text-muted">—</span>
      ),
  },
  { key: 'prompt', header: 'Prompt version', cell: (r) => r.promptVersion },
  {
    key: 'latency',
    header: 'Latency',
    cell: (r) => <span className="tabular">{ms(r.latencyMs)}</span>,
  },
  {
    key: 'tokens',
    header: 'Tokens',
    cell: (r) => (
      <span className="tabular">{number.format(r.usage.inputTokens + r.usage.outputTokens)}</span>
    ),
  },
];

function StatCards({ s }: { s: AiInteractionSummary }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      <StatCard
        label="AI calls"
        value={number.format(s.calls)}
        icon={Activity}
        hint={`${number.format(s.attempts)} attempts incl. retries`}
      />
      <StatCard
        label="Failure rate"
        value={percent(s.failureRate)}
        icon={TriangleAlert}
        tone="danger"
        hint="of attempts"
      />
      <StatCard
        label="Fallback-model rate"
        value={percent(s.fallbackModelRate)}
        icon={Layers}
        tone="warning"
        hint="answers from a backup model"
      />
      <StatCard
        label="Template-fallback rate"
        value={percent(s.templateFallbackRate)}
        icon={Sparkles}
        tone="consult"
        hint={`of ${number.format(s.explanations)} patient explanations`}
      />
      <StatCard
        label="Guardrail blocks"
        value={number.format(s.guardrailBlocks)}
        icon={ShieldAlert}
        tone="warning"
        hint="answers stopped by the safety checks"
      />
      <StatCard
        label="Tokens"
        value={number.format(s.tokens.input + s.tokens.output)}
        icon={Coins}
        tone="info"
        hint={`${number.format(s.tokens.input)} in · ${number.format(s.tokens.output)} out`}
      />
      <StatCard
        label="Latency"
        value={ms(s.latency.averageMs)}
        icon={Timer}
        tone="neutral"
        hint={`average · p95 ${ms(s.latency.p95Ms)}`}
      />
      <StatCard
        label="Helpful"
        value={s.feedback.helpfulPercent === null ? '—' : `${s.feedback.helpfulPercent} %`}
        icon={BadgeCheck}
        tone="success"
        hint={`${number.format(s.feedback.rated)} patient ratings`}
      />
    </div>
  );
}

function OnOff({ on }: { on: boolean }) {
  return <Badge tone={on ? 'success' : 'neutral'}>{on ? 'On' : 'Off'}</Badge>;
}

function ConfigCard({ config: c }: { config: AiConfig }) {
  const used = c.today.limit ? Math.min(1, c.today.calls / c.today.limit) : 1;
  return (
    <SectionCard title="Provider and models" icon={Server} iconTone="info">
      <div className="space-y-5">
        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <span className="font-semibold text-ink">Today’s AI calls</span>
            <span className="tabular text-muted">
              {number.format(c.today.calls)} of {number.format(c.today.limit)} (daily limit)
            </span>
          </div>
          <div
            role="progressbar"
            aria-label="Today’s AI calls against the daily limit"
            aria-valuemin={0}
            aria-valuemax={c.today.limit}
            aria-valuenow={c.today.calls}
            className="mt-2 h-2 overflow-hidden rounded-full bg-neutral-50 ring-1 ring-line"
          >
            <div
              className={`h-full rounded-full ${used >= 0.9 ? 'bg-danger-500' : used >= 0.7 ? 'bg-warning-500' : 'bg-primary-600'}`}
              style={{ width: `${used * 100}%` }}
            />
          </div>
        </div>
        <DescriptionList
          items={[
            { label: 'Provider', value: c.provider },
            { label: 'Base URL host', value: c.baseUrlHost ?? '—' },
            { label: 'Model', value: c.model },
            {
              label: 'Fallback models',
              value: c.fallbackModels.length ? c.fallbackModels.join(', ') : 'None',
            },
            { label: 'Timeout per attempt', value: ms(c.timeoutMs) },
            {
              label: 'Temperature · max tokens',
              value: `${c.temperature} · ${number.format(c.maxTokens)}`,
            },
            { label: 'AI features', value: <OnOff on={c.enabled.ai} /> },
            {
              label: 'Clinical summaries · explanations',
              value: (
                <span className="flex gap-1.5">
                  <OnOff on={c.enabled.ai && c.enabled.clinicalSummary} />
                  <OnOff on={c.enabled.ai && c.enabled.patientExplanation} />
                </span>
              ),
            },
          ]}
        />
      </div>
    </SectionCard>
  );
}

function Charts({ s, loading }: { s: AiInteractionSummary | undefined; loading: boolean }) {
  const days = (s?.perDay ?? []).map((d) => ({ ...d, label: shortDay(d.date) }));
  const empty = !loading && (s?.attempts ?? 0) === 0;
  const busiest = days.reduce((m, d) => (d.attempts > (m?.attempts ?? -1) ? d : m), days[0]);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartCard
        title="Attempts per day"
        description="Failed and blocked attempts stacked on successful ones."
        loading={loading}
        empty={empty}
        summary={
          s
            ? `${s.attempts} attempts from ${formatCalendarDate(s.range.from)} to ${formatCalendarDate(s.range.to)}${busiest ? `; busiest day ${formatCalendarDate(busiest.date)} with ${busiest.attempts}` : ''}.`
            : undefined
        }
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={days.map((d) => ({ ...d, ok: d.attempts - d.failed - d.blocked }))}>
            <CartesianGrid {...CHART_THEME.grid} />
            <XAxis dataKey="label" {...CHART_THEME.axis} minTickGap={16} />
            <YAxis allowDecimals={false} {...CHART_THEME.axis} width={32} />
            <Tooltip {...CHART_THEME.tooltip} />
            <Bar dataKey="ok" name="Success" stackId="a" fill={CHART_COLORS[0]} maxBarSize={24} />
            <Bar dataKey="blocked" name="Blocked" stackId="a" fill={CHART_COLORS[3]} />
            <Bar dataKey="failed" name="Failed" stackId="a" fill={CHART_COLORS[5]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard
        title="Tokens per day"
        description="Input and output tokens together."
        loading={loading}
        empty={empty}
        summary={
          s
            ? `${number.format(s.tokens.input + s.tokens.output)} tokens in this period.`
            : undefined
        }
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={days}>
            <CartesianGrid {...CHART_THEME.grid} />
            <XAxis dataKey="label" {...CHART_THEME.axis} minTickGap={16} />
            <YAxis {...CHART_THEME.axis} width={48} />
            <Tooltip {...CHART_THEME.tooltip} />
            <Line
              type="monotone"
              dataKey="tokens"
              name="Tokens"
              stroke={CHART_COLORS[0]}
              {...CHART_THEME.line}
            />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}

/**
 * /admin/ai-monitor (spec §7.18, Phase 9): AI usage for a date range – calls, failure and
 * fallback rates, safety blocks, tokens, latency, patients' ratings, calls per model and the
 * recent attempts. Never prompts, patient data or AI answers; never the API key.
 */
export default function AiMonitorPage() {
  const [params, setParams] = useSearchParams();
  const today = clinicDate();
  const range = {
    from: params.get('from') ?? addDaysToDate(today, -(DEFAULT_DAYS - 1)),
    to: params.get('to') ?? today,
  };
  const [draft, setDraft] = useState(range);
  const rangeInvalid = range.from > range.to;
  const draftInvalid = Boolean(draft.from && draft.to && draft.from > draft.to);
  const feature = (params.get('feature') ?? '') as AiFeature | '';
  const status = (params.get('status') ?? '') as AiInteractionStatus | '';
  const page = Math.max(1, Number(params.get('page')) || 1);

  const config = useGetAiConfigQuery();
  const summary = useGetAiInteractionSummaryQuery(range, { skip: rangeInvalid });
  const list = useListAiInteractionsQuery(
    {
      ...range,
      page,
      limit: PAGE_SIZE,
      ...(feature ? { feature } : {}),
      ...(status ? { status } : {}),
    },
    { skip: rangeInvalid },
  );

  const update = (changes: Record<string, string>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(changes)) {
          if (v) next.set(k, v);
          else next.delete(k);
        }
        if (!('page' in changes)) next.delete('page');
        return next;
      },
      { replace: true },
    );
  const apply = (e: FormEvent) => {
    e.preventDefault();
    if (!draftInvalid) update({ from: draft.from, to: draft.to });
  };
  const s = summary.data;

  return (
    <section className="space-y-6">
      <PageHeader
        title="AI monitor"
        description="AI calls, failures and safety blocks. No prompts, patient data or AI answers are shown here. Dates are in the clinic timezone."
      />

      <form
        onSubmit={apply}
        aria-label="Date range"
        className="grid gap-3 rounded-card border border-line bg-surface p-4 shadow-card sm:grid-cols-3 lg:p-5"
      >
        <Input
          label="From"
          type="date"
          value={draft.from}
          onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
        />
        <Input
          label="To"
          type="date"
          value={draft.to}
          onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
          error={draftInvalid ? '"To" must be on or after "From"' : undefined}
        />
        <div className="flex items-end gap-2">
          <Button type="submit">Apply</Button>
          <Button
            variant="ghost"
            onClick={() => {
              const reset = { from: addDaysToDate(today, -(DEFAULT_DAYS - 1)), to: today };
              setDraft(reset);
              setParams({}, { replace: true });
            }}
          >
            Last {DEFAULT_DAYS} days
          </Button>
        </div>
      </form>

      {summary.isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4" role="status">
          <span className="sr-only">Loading AI statistics…</span>
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      )}
      {summary.isError && (
        <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />
      )}
      {s && <StatCards s={s} />}

      <div className="grid gap-6 lg:grid-cols-2">
        {config.isLoading && <ListSkeleton label="Loading the AI configuration…" rows={3} />}
        {config.isError && (
          <ErrorState error={config.error} onRetry={() => void config.refetch()} />
        )}
        {config.data && <ConfigCard config={config.data} />}

        <SectionCard title="Calls per model" icon={Gauge} iconTone="primary">
          {summary.isLoading && <ListSkeleton label="Loading models…" rows={2} />}
          {s && s.perModel.length === 0 && (
            <p className="text-sm text-muted">No AI calls in this period.</p>
          )}
          {s && s.perModel.length > 0 && (
            <Table
              caption="AI attempts per model"
              rowKey={(m) => m.model}
              rows={s.perModel}
              columns={[
                {
                  key: 'model',
                  header: 'Model',
                  cell: (m) => <span className="break-all">{m.model}</span>,
                },
                {
                  key: 'attempts',
                  header: 'Attempts',
                  cell: (m) => <span className="tabular">{number.format(m.attempts)}</span>,
                },
                {
                  key: 'failed',
                  header: 'Failed',
                  cell: (m) => <span className="tabular">{number.format(m.failed)}</span>,
                },
                {
                  key: 'blocked',
                  header: 'Blocked',
                  cell: (m) => <span className="tabular">{number.format(m.blocked)}</span>,
                },
              ]}
            />
          )}
        </SectionCard>
      </div>

      <Charts s={s} loading={summary.isLoading} />

      <SectionCard title="Recent AI attempts" icon={Activity} iconTone="neutral">
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:max-w-xl">
          <Select
            label="Feature"
            placeholder="All features"
            options={AI_FEATURES.map((f) => ({ value: f, label: FEATURE_LABELS[f] }))}
            value={feature}
            onChange={(e) => update({ feature: e.target.value })}
          />
          <Select
            label="Status"
            placeholder="Any status"
            options={AI_INTERACTION_STATUSES.map((v) => ({ value: v, label: STATUS_LABELS[v] }))}
            value={status}
            onChange={(e) => update({ status: e.target.value })}
          />
        </div>
        {list.isLoading && <ListSkeleton label="Loading AI attempts…" rows={4} />}
        {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
        {list.data && list.data.items.length === 0 && (
          <EmptyState
            icon={Sparkles}
            title="No AI attempts"
            description="Nothing matches this period and these filters."
          />
        )}
        {list.data && list.data.items.length > 0 && (
          <div aria-busy={list.isFetching || undefined}>
            <Table
              caption="Recent AI attempts"
              columns={columns}
              rows={list.data.items}
              rowKey={(r) => r.id}
            />
            <Pagination meta={list.data.meta} onPageChange={(p) => update({ page: String(p) })} />
          </div>
        )}
      </SectionCard>
    </section>
  );
}
