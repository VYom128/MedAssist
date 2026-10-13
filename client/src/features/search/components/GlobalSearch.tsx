import { Search, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import Spinner from '../../../components/ui/Spinner';
import StatusPill from '../../../components/ui/StatusPill';
import type { StatusDomain, StatusKey } from '../../../components/ui/statusStyles';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { formatDate, formatDateTime } from '../../../utils/dates';
import {
  SEARCH_DEBOUNCE_MS,
  SEARCH_MIN_LENGTH,
  useSearchQuery,
  type SearchGroup,
  type SearchResults,
} from '../api';

const GROUP_LABELS: Record<SearchGroup, string> = {
  patients: 'Patients',
  appointments: 'Appointments',
  invoices: 'Invoices',
  labOrders: 'Lab orders',
};

interface Option {
  key: string;
  group: SearchGroup;
  title: string;
  detail: string;
  link: string;
  status?: { domain: StatusDomain; value: string };
}

const join = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(' · ');
const dr = (name: string | null) => (name ? `Dr ${name}` : null);

/** The results as one list, in group order; records without a page for this role are left out. */
function toOptions(data: SearchResults | undefined): Option[] {
  if (!data) return [];
  const out: Option[] = [];
  for (const p of data.patients ?? []) {
    if (p.link) {
      out.push({
        key: `p-${p.id}`,
        group: 'patients',
        title: p.name ?? '—',
        detail: p.mrn ?? '',
        link: p.link,
      });
    }
  }
  for (const a of data.appointments ?? []) {
    if (a.link) {
      out.push({
        key: `a-${a.id}`,
        group: 'appointments',
        title: a.number,
        detail: join(a.patientName, dr(a.doctorName), formatDateTime(a.startAt)),
        link: a.link,
        status: { domain: 'appointment', value: a.status },
      });
    }
  }
  for (const i of data.invoices ?? []) {
    if (i.link) {
      out.push({
        key: `i-${i.id}`,
        group: 'invoices',
        title: i.number ?? 'Draft invoice',
        detail: join(i.patientName, i.issuedAt ? `Issued ${formatDate(i.issuedAt)}` : null),
        link: i.link,
        status: { domain: 'invoice', value: i.status },
      });
    }
  }
  for (const o of data.labOrders ?? []) {
    if (o.link) {
      out.push({
        key: `l-${o.id}`,
        group: 'labOrders',
        title: o.number ?? 'Lab order',
        detail: join(
          o.sampleId ? `Sample ${o.sampleId}` : null,
          o.patientName,
          o.patientMrn,
          o.orderedAt ? formatDate(o.orderedAt) : null,
        ),
        link: o.link,
        status: { domain: 'labOrder', value: o.status },
      });
    }
  }
  return out;
}

const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * Global search in the top bar (spec §12.1, Phase 10): records the role may see, grouped, at most
 * 5 per group. Searches 250 ms after typing stops and from 2 characters; ↑ ↓ move through the
 * results, Enter opens one, Esc closes; ⌘K / Ctrl+K focuses the box from anywhere. Below 640 px
 * a search button opens the box over the top bar. The query is never kept in the URL or storage.
 */
export default function GlobalSearch() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [active, setActive] = useState(0);
  const term = useDebouncedValue(text.trim(), SEARCH_DEBOUNCE_MS);
  const ready = term.length >= SEARCH_MIN_LENGTH;
  const { data, isFetching, isError, refetch } = useSearchQuery(term, { skip: !ready });
  // Results of an older term are not shown while the new one loads.
  const current = ready && term === text.trim();
  const options = useMemo(() => (current ? toOptions(data) : []), [current, data]);
  const waiting = text.trim().length >= SEARCH_MIN_LENGTH && (!current || isFetching);

  // A new search starts at the first result.
  const [activeTerm, setActiveTerm] = useState(term);
  if (activeTerm !== term) {
    setActiveTerm(term);
    setActive(0);
  }

  // ⌘K / Ctrl+K focuses the search from anywhere.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setMobileOpen(true);
        setOpen(true);
        // The phone box mounts on this render: focus after it.
        requestAnimationFrame(() => inputRef.current?.focus());
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const close = () => {
    setOpen(false);
    setMobileOpen(false);
  };
  const go = (o: Option) => {
    setText('');
    close();
    inputRef.current?.blur();
    navigate(o.link);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (open && text) setOpen(false);
      else {
        setText('');
        close();
        inputRef.current?.blur();
      }
      return;
    }
    if (!options.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % options.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i - 1 + options.length) % options.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const o = options[active];
      if (o) go(o);
    }
  };

  const showPanel = open && text.trim().length > 0;
  const optionId = (i: number) => `${listId}-opt-${i}`;
  const groups = [...new Set(options.map((o) => o.group))];
  const shortcut = isMac() ? '⌘K' : 'Ctrl K';

  return (
    <div className="flex min-w-0 flex-1 justify-end sm:justify-start">
      <button
        type="button"
        aria-label="Open search"
        onClick={() => {
          setMobileOpen(true);
          setOpen(true);
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
        className={`inline-flex h-11 w-11 items-center justify-center rounded-control text-muted hover:bg-surface-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-primary-600 sm:hidden ${mobileOpen ? 'hidden' : ''}`}
      >
        <Search className="h-5 w-5" aria-hidden="true" />
      </button>
      <div
        className={`${
          mobileOpen
            ? 'absolute inset-x-0 top-0 z-40 flex h-16 items-center gap-2 border-b border-line bg-surface px-4'
            : 'hidden'
        } sm:relative sm:inset-auto sm:z-auto sm:flex sm:h-auto sm:w-full sm:max-w-md sm:border-0 sm:bg-transparent sm:p-0`}
      >
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-subtle"
            aria-hidden="true"
          />
          <input
            ref={inputRef}
            type="search"
            role="combobox"
            aria-label="Search records"
            aria-expanded={showPanel}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={showPanel && options.length ? optionId(active) : undefined}
            autoComplete="off"
            spellCheck={false}
            value={text}
            placeholder="Search patients, numbers…"
            onChange={(e) => {
              setText(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => {
              // Let a click on a result land first.
              setTimeout(() => {
                setOpen(false);
                if (!inputRef.current?.value) setMobileOpen(false);
              }, 150);
            }}
            onKeyDown={onKeyDown}
            className="h-10 w-full rounded-control border border-line bg-surface-muted pr-16 pl-9 text-sm text-ink placeholder:text-subtle focus:border-primary-600 focus:bg-surface focus:outline-2 focus:outline-primary-100 [&::-webkit-search-cancel-button]:hidden"
          />
          <span className="pointer-events-none absolute top-1/2 right-2 hidden -translate-y-1/2 rounded border border-line bg-surface px-1.5 py-0.5 text-[11px] font-semibold text-muted md:block">
            {shortcut}
          </span>

          {showPanel && (
            <div
              className="absolute inset-x-0 top-full z-40 mt-2 max-h-[min(28rem,70vh)] overflow-y-auto rounded-card border border-line bg-surface p-1.5 shadow-overlay motion-safe:animate-fade-in"
              // Keep focus in the input while clicking results.
              onMouseDown={(e) => e.preventDefault()}
            >
              {text.trim().length < SEARCH_MIN_LENGTH ? (
                <p className="px-3 py-3 text-sm text-muted">
                  Type at least {SEARCH_MIN_LENGTH} characters.
                </p>
              ) : waiting ? (
                <p role="status" className="flex items-center gap-2 px-3 py-3 text-sm text-muted">
                  <Spinner className="h-4 w-4" /> Searching…
                </p>
              ) : isError ? (
                <div className="flex items-center justify-between gap-2 px-3 py-2 text-sm text-muted">
                  <p role="alert">Search failed.</p>
                  <button
                    type="button"
                    onClick={() => void refetch()}
                    className="rounded-control px-2 py-1 font-semibold text-primary-700 hover:bg-primary-50"
                  >
                    Try again
                  </button>
                </div>
              ) : options.length === 0 ? (
                <p role="status" className="px-3 py-3 text-sm text-muted">
                  No results for “{term}”.
                </p>
              ) : null}
              <ul
                id={listId}
                role="listbox"
                aria-label="Search results"
                className={options.length ? '' : 'hidden'}
              >
                {groups.map((g) => (
                  <li key={g} role="presentation">
                    <p
                      role="presentation"
                      className="px-3 pt-2 pb-1 text-caption text-muted uppercase"
                    >
                      {GROUP_LABELS[g]}
                    </p>
                    <ul role="group" aria-label={GROUP_LABELS[g]}>
                      {options.map((o, i) =>
                        o.group !== g ? null : (
                          <li
                            key={o.key}
                            id={optionId(i)}
                            role="option"
                            aria-selected={i === active}
                            onMouseEnter={() => setActive(i)}
                            onClick={() => go(o)}
                            className={`flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-control px-3 py-2 ${
                              i === active ? 'bg-primary-50' : ''
                            }`}
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-semibold text-ink">
                                {o.title}
                              </span>
                              {o.detail && (
                                <span className="tabular block truncate text-xs text-muted">
                                  {o.detail}
                                </span>
                              )}
                            </span>
                            {o.status && (
                              <StatusPill
                                domain={o.status.domain}
                                status={o.status.value as StatusKey<StatusDomain>}
                                size="sm"
                              />
                            )}
                          </li>
                        ),
                      )}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        {mobileOpen && (
          <button
            type="button"
            aria-label="Close search"
            onClick={() => {
              setText('');
              close();
            }}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-muted hover:bg-surface-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-primary-600 sm:hidden"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
