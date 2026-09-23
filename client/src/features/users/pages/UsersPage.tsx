import { Plus, Search, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageHeader from '../../../components/PageHeader';
import Alert from '../../../components/ui/Alert';
import Badge from '../../../components/ui/Badge';
import Button from '../../../components/ui/Button';
import EmptyState from '../../../components/ui/EmptyState';
import Input from '../../../components/ui/Input';
import Pagination from '../../../components/ui/Pagination';
import Select from '../../../components/ui/Select';
import Table, { type Column } from '../../../components/ui/Table';
import { ROLE_LABELS, ROLE_VALUES, type Role } from '../../../constants/roles';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { formatDateTime } from '../../../utils/dates';
import { getQueryErrorMessage } from '../../../utils/http';
import { useListUsersQuery, type AdminUser } from '../api';
import AddStaffModal from '../components/AddStaffModal';
import UserActions from '../components/UserActions';
import UserStatusBadge from '../components/UserStatusBadge';

const PAGE_SIZE = 20;
const ROLE_OPTIONS = ROLE_VALUES.map((r) => ({ value: r, label: ROLE_LABELS[r] }));
const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];

const columns: Column<AdminUser>[] = [
  {
    key: 'name',
    header: 'Name',
    cell: (u) => (
      <div className="min-w-0">
        <p className="font-medium text-slate-900">
          {u.firstName} {u.lastName}
        </p>
        <p className="break-all text-slate-500">{u.email}</p>
      </div>
    ),
  },
  { key: 'role', header: 'Role', cell: (u) => <Badge tone="info">{ROLE_LABELS[u.role]}</Badge> },
  { key: 'status', header: 'Status', cell: (u) => <UserStatusBadge user={u} /> },
  {
    key: 'lastLogin',
    header: 'Last login',
    cell: (u) => (
      <span className="whitespace-nowrap text-slate-600">{formatDateTime(u.lastLoginAt)}</span>
    ),
  },
  {
    key: 'actions',
    header: 'Actions',
    cell: (u) => <UserActions user={u} />,
    className: 'text-right',
  },
];

/** /admin/users – filters and page live in the URL so views can be shared and survive reloads. */
export default function UsersPage() {
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState(params.get('q') ?? '');
  const debouncedSearch = useDebouncedValue(search.trim());

  const role = (params.get('role') ?? '') as Role | '';
  const status = params.get('status') ?? '';
  const page = Math.max(1, Number(params.get('page')) || 1);

  const update = (changes: Record<string, string>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(changes)) {
          if (v) next.set(k, v);
          else next.delete(k);
        }
        if (!('page' in changes)) next.delete('page'); // new filters start at page 1
        return next;
      },
      { replace: true },
    );

  useEffect(() => {
    if ((params.get('q') ?? '') !== debouncedSearch) update({ q: debouncedSearch });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to the debounced text
  }, [debouncedSearch]);

  const { data, isLoading, isFetching, isError, error, refetch } = useListUsersQuery({
    page,
    limit: PAGE_SIZE,
    ...(role ? { role } : {}),
    ...(status ? { isActive: status === 'active' } : {}),
    ...(params.get('q') ? { q: params.get('q') ?? '' } : {}),
    sort: 'lastName,firstName',
  });

  const filtered = Boolean(role || status || params.get('q'));

  return (
    <section className="mx-auto w-full max-w-6xl">
      <PageHeader
        title="Users"
        description="Staff and patient login accounts."
        actions={
          <Button onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" /> Add staff
          </Button>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Input
          label="Search"
          type="search"
          placeholder="Name or email"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          trailing={<Search className="mr-1 h-4 w-4 text-slate-400" aria-hidden="true" />}
        />
        <Select
          label="Role"
          placeholder="All roles"
          options={ROLE_OPTIONS}
          value={role}
          onChange={(e) => update({ role: e.target.value })}
        />
        <Select
          label="Status"
          placeholder="Any status"
          options={STATUS_OPTIONS}
          value={status}
          onChange={(e) => update({ status: e.target.value })}
        />
      </div>

      {isLoading && (
        <div className="space-y-2" role="status">
          <span className="sr-only">Loading users…</span>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-slate-100" />
          ))}
        </div>
      )}

      {isError && (
        <div className="space-y-3">
          <Alert tone="error">{getQueryErrorMessage(error)}</Alert>
          <Button variant="secondary" onClick={() => void refetch()}>
            Try again
          </Button>
        </div>
      )}

      {data && data.items.length === 0 && (
        <EmptyState
          icon={Users}
          title={filtered ? 'No users match these filters' : 'No users yet'}
          description={filtered ? 'Try another search or clear the filters.' : undefined}
          action={
            filtered ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setSearch('');
                  setParams({}, { replace: true });
                }}
              >
                Clear filters
              </Button>
            ) : (
              <Button onClick={() => setAdding(true)}>Add staff</Button>
            )
          }
        />
      )}

      {data && data.items.length > 0 && (
        <div aria-busy={isFetching || undefined}>
          <Table caption="Users" columns={columns} rows={data.items} rowKey={(u) => u.id} />
          <Pagination meta={data.meta} onPageChange={(p) => update({ page: String(p) })} />
        </div>
      )}

      <AddStaffModal open={adding} onClose={() => setAdding(false)} />
    </section>
  );
}
