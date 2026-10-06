import { Check, Plus, Search, X } from 'lucide-react';
import { useState } from 'react';
import ErrorState from '../../../components/ui/ErrorState';
import Input from '../../../components/ui/Input';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import Select from '../../../components/ui/Select';
import {
  LAB_RULES,
  LAB_TEST_CATEGORIES,
  optionsOf,
  type LabTestCategory,
} from '../../../constants/catalog';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { formatINR } from '../../../utils/money';
import { useListLabTestsQuery } from '../../labTests/api';

/** A chosen test (id + what the chip shows). */
export interface PickedTest {
  id: string;
  code: string;
  name: string;
}

/**
 * Picks tests from the catalogue (spec §4.7 "lab orders"): search by name or code, filter by
 * category; each result shows the sample type, preparation and price. Chosen tests appear as
 * removable chips.
 */
export default function TestPicker({
  value,
  onChange,
  error,
}: {
  value: PickedTest[];
  onChange: (tests: PickedTest[]) => void;
  error?: string;
}) {
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<LabTestCategory | ''>('');
  const search = useDebouncedValue(q.trim());
  const list = useListLabTestsQuery({
    limit: 20,
    ...(search ? { q: search } : {}),
    ...(category ? { category } : {}),
  });
  const chosen = new Set(value.map((t) => t.id));
  const full = value.length >= LAB_RULES.maxTests;

  const toggle = (t: PickedTest) =>
    onChange(chosen.has(t.id) ? value.filter((x) => x.id !== t.id) : [...value, t]);

  return (
    <div className="space-y-3">
      <div aria-live="polite">
        {value.length === 0 ? (
          <p className={`text-sm ${error ? 'font-semibold text-danger-700' : 'text-muted'}`}>
            {error ?? 'No tests chosen yet.'}
          </p>
        ) : (
          <ul aria-label="Chosen tests" className="flex flex-wrap gap-1.5">
            {value.map((t) => (
              <li
                key={t.id}
                className="inline-flex items-center gap-1 rounded-full bg-primary-50 py-1 pr-1 pl-2.5 text-xs font-semibold text-primary-700 ring-1 ring-primary-100 ring-inset"
              >
                {t.name} <span className="font-normal">({t.code})</span>
                <button
                  type="button"
                  onClick={() => toggle(t)}
                  aria-label={`Remove ${t.name}`}
                  className="rounded-full p-0.5 hover:bg-primary-100 focus-visible:outline-2 focus-visible:outline-primary-600"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
        <Input
          label="Search tests"
          placeholder="Name or code, e.g. CBC"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          trailing={<Search className="h-4 w-4 text-muted" aria-hidden="true" />}
        />
        <Select
          label="Category"
          placeholder="All categories"
          options={optionsOf(LAB_TEST_CATEGORIES)}
          value={category}
          onChange={(e) => setCategory(e.target.value as LabTestCategory | '')}
        />
      </div>
      {list.isLoading && <ListSkeleton label="Loading tests…" rows={3} />}
      {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
      {list.data && list.data.items.length === 0 && (
        <p className="text-sm text-muted">No tests match.</p>
      )}
      <ul aria-label="Lab tests" className="max-h-72 space-y-1 overflow-y-auto pr-1">
        {(list.data?.items ?? []).map((t) => {
          const on = chosen.has(t.id);
          return (
            <li key={t.id}>
              <button
                type="button"
                aria-pressed={on}
                disabled={!on && full}
                onClick={() => toggle({ id: t.id, code: t.code, name: t.name })}
                className={`flex w-full items-start gap-3 rounded-control border px-3 py-2 text-left transition-colors duration-150 ease-standard focus-visible:outline-2 focus-visible:outline-primary-600 disabled:opacity-50 ${on ? 'border-primary-300 bg-primary-50' : 'border-line hover:bg-neutral-50'}`}
              >
                <span
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${on ? 'bg-primary-600 text-white' : 'bg-neutral-100 text-muted'}`}
                  aria-hidden="true"
                >
                  {on ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="font-semibold text-ink">
                      {t.name} <span className="font-normal text-muted">({t.code})</span>
                    </span>
                    <span className="text-sm text-ink tabular">{formatINR(t.pricePaise)}</span>
                  </span>
                  <span className="block text-xs text-muted">
                    Sample: {t.sampleType}
                    {t.preparation ? ` · ${t.preparation}` : ''}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {full && (
        <p className="text-sm text-muted">At most {LAB_RULES.maxTests} tests in one order.</p>
      )}
    </div>
  );
}
