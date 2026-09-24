import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { controlClass } from './controlClass';
import FormField from './FormField';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  hint?: ReactNode;
  /** Rendered inside the field on the right (e.g. a show-password button). */
  trailing?: ReactNode;
  /** Reserve a line for the error message (no layout shift; used on short forms). */
  reserveMessage?: boolean;
}

/** Labelled text input with an accessible error message. Works with react-hook-form's register(). */
const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, hint, trailing, reserveMessage, id, className = '', ...rest },
  ref,
) {
  const autoId = useId();
  return (
    <FormField
      id={id ?? autoId}
      label={label}
      hint={hint}
      error={error}
      className={className}
      reserveMessage={reserveMessage}
    >
      {({ inputId, describedBy, invalid }) => (
        <div className="relative">
          <input
            ref={ref}
            id={inputId}
            aria-invalid={invalid}
            aria-describedby={describedBy}
            className={controlClass(error, trailing ? 'pr-12!' : '')}
            {...rest}
          />
          {trailing && (
            <div className="absolute inset-y-0 right-0 flex items-center pr-1">{trailing}</div>
          )}
        </div>
      )}
    </FormField>
  );
});

export default Input;
