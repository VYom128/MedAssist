import { forwardRef, useId, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { controlClass } from './controlClass';
import FormField from './FormField';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  error?: string;
  hint?: ReactNode;
}

/** Labelled multi-line input. Works with react-hook-form's register(). */
const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, error, hint, id, className = '', rows = 3, ...rest },
  ref,
) {
  const autoId = useId();
  return (
    <FormField id={id ?? autoId} label={label} hint={hint} error={error} className={className}>
      {({ inputId, describedBy, invalid }) => (
        <textarea
          ref={ref}
          id={inputId}
          rows={rows}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          className={controlClass(error)}
          {...rest}
        />
      )}
    </FormField>
  );
});

export default Textarea;
