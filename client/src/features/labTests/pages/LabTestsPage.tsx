import { FlaskConical, Plus, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Button from '../../../components/ui/Button';
import { buttonClass } from '../../../components/ui/buttonClass';
import Code from '../../../components/ui/Code';
import EmptyState from '../../../components/ui/EmptyState';
import ErrorState from '../../../components/ui/ErrorState';
import FilterBar from '../../../components/ui/FilterBar';
import Input from '../../../components/ui/Input';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import IconChip from '../../../components/ui/IconChip';
import PageHeader from '../../../components/ui/PageHeader';
import Pagination from '../../../components/ui/Pagination';
import Select from '../../../components/ui/Select';
import StatusBadge from '../../../components/ui/StatusBadge';
import Table, { type Column } from '../../../components/ui/Table';
import {
  capitalise,
  LAB_TEST_CATEGORIES,
  optionsOf,
  type LabTestCategory,
} from '../../../constants/catalog';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { useListParams } from '../../../hooks/useListParams';
import { formatINR } from '../../../utils/money';
import { useListLabTestsQuery, type LabTest } from '../api';

const PAGE_SIZE = 20;

const testCell = (t: LabTest) => (
  <div className="flex min-w-0 items-center gap-3">
    <IconChip icon={FlaskConical} tone="consult" size="sm" />
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <Link
        to={`/admin/lab-tests/${t.id}`}
        className="rounded font-semibold text-primary-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
      >
        {t.name}
      </Link>
      <Code>{t.code}</Code>
    </div>
  </div>
);

const columns: Column<LabTest>[] = [
  { key: 'name', header: 'Test', hideOnCard: true, cell: testCell },
  { key: 'category', header: 'Category', cell: (t) => capitalise(t.category) },
  { key: 'sample', header: 'Sample', cell: (t) => capitalise(t.sampleType) },
  {
    key: 'price',
    header: 'Price',
    className: 'whitespace-nowrap',
    cell: (t) => <span className="tabular font-semibold text-ink">{formatINR(t.pricePaise)}</span>,
  },
  {
    key: 'tat',
    header: 'TAT',
    cell: (t) => (
      <span className="tabular">{t.turnaroundHours ? `${t.turnaroundHours} h` : '—'}</span>
    ),
  },
  { key: 'status', header: 'Status', cell: (t) => <StatusBadge active={t.isActive !== false} /> },
];

/** /admin/lab-tests – the lab test catalogue (spec §6.19). */
export default function LabTestsPage() {
  const list = useListParams();
  const [search, setSearch] = useState(list.get('q'));
  const debounced = useDebouncedValue(search.trim());

  useEffect(() => {
    if (list.get('q') !== debounced) list.update({ q: debounced });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to the debounced text
  }, [debounced]);

  const category = list.get('category') as LabTestCategory | '';
  const { data, isLoading, isFetching, isError, error, refetch } = useListLabTestsQuery({
    page: list.page,
    limit: PAGE_SIZE,
    includeInactive: true,
    ...(category ? { category } : {}),
    ...(list.get('q') ? { q: list.get('q') } : {}),
  });
  const filtered = list.hasAny('q', 'category');
  const clear = () => {
    setSearch('');
    list.clear();
  };

  return (
    <section>
      <PageHeader
        title="Lab tests"
        description="The tests doctors can order, with parameters and reference ranges."
        actions={
          <Link to="/admin/lab-tests/new" className={buttonClass()}>
            <Plus className="h-4 w-4" aria-hidden="true" /> Add lab test
          </Link>
        }
      />
      <FilterBar onClear={filtered ? clear : undefined}>
        <Input
          label="Search"
          type="search"
          placeholder="Name or code"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          trailing={<Search className="mr-2 h-4 w-4 text-subtle" aria-hidden="true" />}
        />
        <Select
          label="Category"
          placeholder="All categories"
          options={optionsOf(LAB_TEST_CATEGORIES)}
          value={category}
          onChange={(e) => list.update({ category: e.target.value })}
        />
      </FilterBar>

      {isLoading && <ListSkeleton label="Loading lab tests…" />}
      {isError && <ErrorState error={error} onRetry={() => void refetch()} />}
      {data && data.items.length === 0 && (
        <EmptyState
          icon={FlaskConical}
          title={filtered ? 'No lab tests match these filters' : 'No lab tests yet'}
          action={
            filtered ? (
              <Button variant="secondary" onClick={clear}>
                Clear filters
              </Button>
            ) : (
              <Link to="/admin/lab-tests/new" className={buttonClass()}>
                Add the first lab test
              </Link>
            )
          }
        />
      )}
      {data && data.items.length > 0 && (
        <div aria-busy={isFetching || undefined}>
          <Table
            caption="Lab tests"
            columns={columns}
            rows={data.items}
            rowKey={(t) => t.id}
            cardHeader={testCell}
          />
          <Pagination meta={data.meta} onPageChange={(p) => list.update({ page: String(p) })} />
        </div>
      )}
    </section>
  );
}
