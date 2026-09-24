import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface TabItem {
  id: string;
  label: string;
  /** Marks the tab (e.g. it contains fields with errors). */
  alert?: boolean;
}

/**
 * Accessible tabs (WAI-ARIA tabs pattern: arrow keys, Home/End). Renders the tab list and the
 * active panel; the tab list scrolls sideways on phones.
 */
export default function Tabs({
  tabs,
  value,
  onChange,
  label,
  children,
  variant = 'underline',
}: {
  tabs: readonly TabItem[];
  value: string;
  onChange: (id: string) => void;
  label: string;
  /** The active tab's content. */
  children: ReactNode;
  /** `underline` (default) for page sections, `pills` for settings-style tab rows. */
  variant?: 'underline' | 'pills';
}) {
  const base = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = Math.max(
    0,
    tabs.findIndex((t) => t.id === value),
  );

  const onKeyDown = (e: KeyboardEvent) => {
    const moves: Record<string, number> = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1,
      Home: 0,
      End: tabs.length - 1,
    };
    if (!(e.key in moves)) return;
    e.preventDefault();
    const next = (moves[e.key]! + tabs.length) % tabs.length;
    onChange(tabs[next]!.id);
    refs.current[next]?.focus();
  };

  return (
    <div>
      <div
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        className={
          variant === 'pills'
            ? '-mx-4 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:inline-flex sm:max-w-full sm:rounded-control sm:border sm:border-line sm:bg-surface sm:p-1 sm:shadow-card'
            : '-mx-4 flex gap-1 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0'
        }
      >
        {tabs.map((t, i) => {
          const selected = i === index;
          return (
            <button
              key={t.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${base}-tab-${t.id}`}
              aria-selected={selected}
              aria-controls={`${base}-panel-${t.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(t.id)}
              className={`flex min-h-11 shrink-0 items-center gap-1.5 px-3.5 text-sm font-semibold whitespace-nowrap transition-colors duration-200 ease-standard focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-600 ${
                variant === 'pills'
                  ? selected
                    ? 'rounded-[0.625rem] bg-primary-600 text-white shadow-card'
                    : 'rounded-[0.625rem] text-muted hover:bg-neutral-50 hover:text-ink'
                  : selected
                    ? '-mb-px border-b-2 border-primary-600 text-primary-700'
                    : '-mb-px border-b-2 border-transparent text-muted hover:border-line-strong hover:text-ink'
              }`}
            >
              {t.label}
              {t.alert && (
                <>
                  <span
                    aria-hidden="true"
                    className="h-2 w-2 rounded-full bg-danger-500 ring-2 ring-surface"
                  />
                  <span className="sr-only">(has errors)</span>
                </>
              )}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={`${base}-panel-${tabs[index]?.id}`}
        aria-labelledby={`${base}-tab-${tabs[index]?.id}`}
        tabIndex={0}
        className="mt-5 rounded-control focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary-600"
      >
        {/* Keyed by tab so each switch fades in (tab content already remounts on switch). */}
        <div key={tabs[index]?.id} className="motion-safe:animate-fade-in">
          {children}
        </div>
      </div>
    </div>
  );
}
