import { forwardRef, useId, type ReactNode, type SelectHTMLAttributes } from 'react';
import { controlClass } from './controlClass';
import FormField from './FormField';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  error?: string;
  hint?: ReactNode;
  options: readonly { value: string; label: string }[];
  /** Adds a first option with an empty value (e.g. "All roles"). */
  placeholder?: string;
}

const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, error, hint, options, placeholder, id, className = '', ...rest },
  ref,
) {
  const autoId = useId();
  return (
    <FormField id={id ?? autoId} label={label} hint={hint} error={error} className={className}>
      {({ inputId, describedBy, invalid }) => (
        <select
          ref={ref}
          id={inputId}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          className={controlClass(error)}
          {...rest}
        >
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </FormField>
  );
});

export default Select;
