/**
 * Shared control classes (inputs, selects, textareas): 44 px tall, 3:1 outline, a primary focus
 * ring and a red one for errors.
 */
export const controlClass = (error?: string, extra = '') =>
  `block min-h-11 w-full rounded-control border bg-surface px-3.5 py-2 text-sm text-ink placeholder:text-subtle transition-[border-color,box-shadow] duration-150 ease-standard focus:outline-none focus:ring-4 disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-muted ${
    error
      ? 'border-danger-600 focus:border-danger-600 focus:ring-danger-100'
      : 'border-line-control hover:border-muted focus:border-primary-600 focus:ring-primary-100'
  } ${extra}`;
