import type { ReactNode } from 'react';

/** A short code or identifier (service code, lab test code, MRN) in a mono chip. */
export default function Code({ children }: { children: ReactNode }) {
  return (
    <span className="tabular inline-block rounded-md bg-neutral-50 px-1.5 py-0.5 font-mono text-xs font-medium whitespace-nowrap text-neutral-700 ring-1 ring-neutral-100 ring-inset">
      {children}
    </span>
  );
}
