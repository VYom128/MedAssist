import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  hint?: string;
  /** Rendered inside the field on the right (e.g. a show-password button). */
  trailing?: ReactNode;
}

/** Labelled text input with an accessible error message. Works with react-hook-form's register(). */
const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, hint, trailing, id, className = '', ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;

  return (
    <div className={className}>
      <label htmlFor={inputId} className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      <div className="relative mt-1">
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={`block w-full rounded-lg border bg-white px-3 py-2 text-sm shadow-sm focus:outline-2 focus:outline-offset-0 ${
            error
              ? 'border-rose-400 focus:outline-rose-500'
              : 'border-slate-300 focus:outline-brand-600'
          } ${trailing ? 'pr-16' : ''}`}
          {...rest}
        />
        {trailing && (
          <div className="absolute inset-y-0 right-0 flex items-center pr-2">{trailing}</div>
        )}
      </div>
      {error ? (
        <p id={`${inputId}-error`} className="mt-1 text-sm text-rose-600">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="mt-1 text-xs text-slate-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
});

export default Input;
