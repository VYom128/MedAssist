import { forwardRef, useEffect, useId, useState, type ReactNode } from 'react';
import { paiseToRupees, rupeesToPaise } from '../../utils/money';
import { controlClass } from './controlClass';
import FormField from './FormField';

/**
 * Amount input: the user types rupees, `value` / `onChange` use integer paise (spec §3.7).
 * Empty → null; text that is not an amount → NaN (let the form schema report it). Use with
 * react-hook-form's Controller.
 */
const MoneyInput = forwardRef<
  HTMLInputElement,
  {
    label: string;
    value: number | null | undefined;
    onChange: (paise: number | null) => void;
    onBlur?: () => void;
    error?: string;
    hint?: ReactNode;
    id?: string;
    name?: string;
    className?: string;
    disabled?: boolean;
  }
>(function MoneyInput(
  { label, value, onChange, onBlur, error, hint, id, className = '', ...rest },
  ref,
) {
  const autoId = useId();
  const [text, setText] = useState(() => paiseToRupees(value));

  // Follow outside changes (form reset) unless they are what the user is typing.
  useEffect(() => {
    setText((current) => {
      const typed = rupeesToPaise(current);
      return typed === (value ?? null) || (Number.isNaN(typed) && Number.isNaN(value))
        ? current
        : paiseToRupees(value);
    });
  }, [value]);

  return (
    <FormField id={id ?? autoId} label={label} hint={hint} error={error} className={className}>
      {({ inputId, describedBy, invalid }) => (
        <div className="relative">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-sm text-slate-500"
          >
            ₹
          </span>
          <input
            ref={ref}
            id={inputId}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            aria-invalid={invalid}
            aria-describedby={describedBy}
            className={controlClass(error, 'pl-7')}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              onChange(rupeesToPaise(e.target.value));
            }}
            onBlur={() => {
              const paise = rupeesToPaise(text);
              if (paise !== null && !Number.isNaN(paise)) setText(paiseToRupees(paise));
              onBlur?.();
            }}
            {...rest}
          />
        </div>
      )}
    </FormField>
  );
});

export default MoneyInput;
