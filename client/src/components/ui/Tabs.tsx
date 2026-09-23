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
}: {
  tabs: readonly TabItem[];
  value: string;
  onChange: (id: string) => void;
  label: string;
  /** The active tab's content. */
  children: ReactNode;
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
        className="-mx-4 flex gap-1 overflow-x-auto border-b border-slate-200 px-4 sm:mx-0 sm:px-0"
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
              className={`-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap focus-visible:outline-2 focus-visible:outline-brand-600 ${
                selected
                  ? 'border-brand-600 text-brand-700'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              {t.label}
              {t.alert && (
                <>
                  <span aria-hidden="true" className="h-2 w-2 rounded-full bg-rose-500" />
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
        className="pt-5"
      >
        {children}
      </div>
    </div>
  );
}
