/** Shared control classes (inputs, selects) with visible focus and error styles. */
export const controlClass = (error?: string, extra = '') =>
  `block w-full rounded-lg border bg-white px-3 py-2 text-sm shadow-sm focus:outline-2 focus:outline-offset-0 ${
    error ? 'border-rose-400 focus:outline-rose-500' : 'border-slate-300 focus:outline-brand-600'
  } ${extra}`;
