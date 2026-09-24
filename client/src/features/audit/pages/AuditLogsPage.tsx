import { ScrollText, ShieldCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import Alert from '../../../components/ui/Alert';
import Button from '../../../components/ui/Button';
import Code from '../../../components/ui/Code';
import EmptyState from '../../../components/ui/EmptyState';
import ErrorState from '../../../components/ui/ErrorState';
import Input from '../../../components/ui/Input';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import PageHeader from '../../../components/ui/PageHeader';
import Pagination from '../../../components/ui/Pagination';
import Select from '../../../components/ui/Select';
import StatusPill from '../../../components/ui/StatusPill';
import Table, { type Column } from '../../../components/ui/Table';
import { ROLE_LABELS, type Role } from '../../../constants/roles';
import { clinicDayBoundary, formatDateTime } from '../../../utils/dates';
import { getQueryErrorMessage } from '../../../utils/http';
import { useListUsersQuery } from '../../users/api';
import {
  useListAuditLogsQuery,
  useVerifyAuditChainMutation,
  type AuditEntry,
  type ChainVerification,
} from '../api';

const PAGE_SIZE = 25;
const OUTCOME_OPTIONS = [
  { value: 'success', label: 'Success' },
  { value: 'denied', label: 'Denied' },
  { value: 'failure', label: 'Failure' },
];
const REASONS: Record<NonNullable<ChainVerification['reason']>, string> = {
  hash_mismatch: 'its content was changed after it was written',
  prev_hash_mismatch:
    'it no longer links to the entry before it (an entry was removed or re-linked)',
  sequence_gap: 'an entry is missing from the sequence',
};

const shortId = (id: string | null) => (id ? `…${id.slice(-6)}` : '');

const columns: Column<AuditEntry>[] = [
  {
    key: 'at',
    header: 'Time',
    cell: (e) => (
      <span className="tabular whitespace-nowrap text-muted">{formatDateTime(e.at)}</span>
    ),
  },
  {
    key: 'actor',
    header: 'Actor',
    cell: (e) =>
      e.actor.name ? (
        <div>
          <p className="font-medium text-ink">{e.actor.name}</p>
          {e.actor.role && (
            <p className="text-xs text-muted">
              {ROLE_LABELS[e.actor.role as Role] ?? e.actor.role}
            </p>
          )}
        </div>
      ) : (
        <span className="text-muted">System / anonymous</span>
      ),
  },
  { key: 'action', header: 'Action', cell: (e) => <Code>{e.action}</Code> },
  {
    key: 'resource',
    header: 'Resource',
    cell: (e) =>
      e.resource ? (
        <span className="text-muted">
          {e.resource.type} {e.resource.number ?? shortId(e.resource.id)}
        </span>
      ) : (
        '—'
      ),
  },
  {
    key: 'outcome',
    header: 'Outcome',
    cell: (e) => <StatusPill domain="auditOutcome" status={e.outcome} />,
  },
];

function Json({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) return null;
  return (
    <div>
      <p className="text-caption text-muted uppercase">{label}</p>
      <pre className="mt-1 overflow-x-auto rounded-control bg-surface p-3 text-xs text-body ring-1 ring-line">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function EntryDetails({ entry }: { entry: AuditEntry }) {
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <Json label="Changes" value={entry.changes} />
      <Json label="Metadata" value={entry.metadata} />
      <Json label="Request" value={entry.request} />
      {!entry.changes && !entry.metadata && !entry.request && (
        <p className="text-sm text-muted">No further details.</p>
      )}
    </div>
  );
}

/** /admin/audit-logs – who did what, when; with a hash-chain integrity check. */
export default function AuditLogsPage() {
  const [params, setParams] = useSearchParams();
  const [
    verify,
    { data: verification, isLoading: verifying, error: verifyError, reset: clearVerification },
  ] = useVerifyAuditChainMutation();

  const filters = {
    action: params.get('action') ?? '',
    actor: params.get('actor') ?? '',
    outcome: params.get('outcome') ?? '',
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
  };
  const [draft, setDraft] = useState(filters);
  const page = Math.max(1, Number(params.get('page')) || 1);
  const rangeInvalid = Boolean(filters.from && filters.to && filters.from > filters.to);

  const { data: actors } = useListUsersQuery({ limit: 100, sort: 'lastName,firstName' });
  const { data, isLoading, isFetching, isError, error, refetch } = useListAuditLogsQuery(
    {
      page,
      limit: PAGE_SIZE,
      ...(filters.action ? { action: filters.action } : {}),
      ...(filters.actor ? { actor: filters.actor } : {}),
      ...(filters.outcome ? { outcome: filters.outcome } : {}),
      ...(filters.from ? { from: clinicDayBoundary(filters.from, 'start') } : {}),
      ...(filters.to ? { to: clinicDayBoundary(filters.to, 'end') } : {}),
    },
    { skip: rangeInvalid },
  );

  const apply = (e: FormEvent) => {
    e.preventDefault();
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(draft)) if (v.trim()) next.set(k, v.trim());
    setParams(next, { replace: true });
  };
  const clear = () => {
    const empty = { action: '', actor: '', outcome: '', from: '', to: '' };
    setDraft(empty);
    setParams({}, { replace: true });
  };
  const goTo = (p: number) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('page', String(p));
        return next;
      },
      { replace: true },
    );

  const set = (key: keyof typeof draft) => (e: { target: { value: string } }) =>
    setDraft((d) => ({ ...d, [key]: e.target.value }));
  const filtered = Object.values(filters).some(Boolean);

  return (
    <section>
      <PageHeader
        title="Audit log"
        description="Every sign-in, account change and denied access. Times are in the clinic timezone."
        actions={
          <Button
            variant="secondary"
            onClick={() =>
              void verify()
                .unwrap()
                .catch(() => undefined)
            }
            loading={verifying}
          >
            <ShieldCheck className="h-4 w-4" aria-hidden="true" /> Verify integrity
          </Button>
        }
      />

      {verification && (
        <div className="mb-4">
          <Alert
            tone={verification.ok ? 'success' : 'error'}
            title={verification.ok ? 'Audit log is intact' : 'Audit log has been tampered with'}
          >
            {verification.ok
              ? `All ${verification.checked} entries verified.`
              : `Entry ${verification.firstBrokenId ?? ''} failed the check: ${
                  verification.reason ? REASONS[verification.reason] : 'unknown reason'
                }. ${verification.checked} entries checked.`}
            <div className="mt-2">
              <Button variant="ghost" size="sm" onClick={clearVerification}>
                Dismiss
              </Button>
            </div>
          </Alert>
        </div>
      )}
      {verifyError && (
        <div className="mb-4">
          <Alert tone="error">{getQueryErrorMessage(verifyError)}</Alert>
        </div>
      )}

      <form
        onSubmit={apply}
        className="mb-4 grid gap-3 rounded-card border border-line bg-surface p-4 shadow-card sm:grid-cols-2 lg:grid-cols-6 lg:p-5"
        aria-label="Filter audit log"
      >
        <Input
          label="Action starts with"
          placeholder="auth. or user.create"
          value={draft.action}
          onChange={set('action')}
          className="lg:col-span-2"
        />
        <Select
          label="Actor"
          placeholder="Anyone"
          options={(actors?.items ?? []).map((u) => ({
            value: u.id,
            label: `${u.firstName} ${u.lastName} (${ROLE_LABELS[u.role]})`,
          }))}
          value={draft.actor}
          onChange={set('actor')}
          className="lg:col-span-2"
        />
        <Select
          label="Outcome"
          placeholder="Any"
          options={OUTCOME_OPTIONS}
          value={draft.outcome}
          onChange={set('outcome')}
          className="lg:col-span-2"
        />
        <Input
          label="From"
          type="date"
          value={draft.from}
          onChange={set('from')}
          className="lg:col-span-2"
        />
        <Input
          label="To"
          type="date"
          value={draft.to}
          onChange={set('to')}
          className="lg:col-span-2"
          error={rangeInvalid ? '"To" must be on or after "From"' : undefined}
        />
        <div className="flex items-end gap-2 lg:col-span-2">
          <Button type="submit">Apply</Button>
          <Button variant="ghost" onClick={clear}>
            Clear
          </Button>
        </div>
      </form>

      {isLoading && <ListSkeleton label="Loading audit log…" rows={5} />}

      {isError && <ErrorState error={error} onRetry={() => void refetch()} />}

      {data && data.items.length === 0 && (
        <EmptyState
          icon={ScrollText}
          title={filtered ? 'No entries match these filters' : 'No audit entries yet'}
          action={
            filtered ? (
              <Button variant="secondary" onClick={clear}>
                Clear filters
              </Button>
            ) : undefined
          }
        />
      )}

      {data && data.items.length > 0 && (
        <div aria-busy={isFetching || undefined}>
          <Table
            caption="Audit log entries"
            columns={columns}
            rows={data.items}
            rowKey={(e) => e.id}
            renderExpanded={(e) => <EntryDetails entry={e} />}
          />
          <Pagination meta={data.meta} onPageChange={goTo} />
        </div>
      )}
    </section>
  );
}
