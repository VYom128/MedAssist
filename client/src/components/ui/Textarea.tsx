import {
  forwardRef,
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { controlClass } from './controlClass';
import FormField from './FormField';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  error?: string;
  hint?: ReactNode;
  /** Grow with the text instead of scrolling (long clinical notes). */
  autoGrow?: boolean;
}

/** Labelled multi-line input. Works with react-hook-form's register(). */
const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, error, hint, id, className = '', rows = 3, autoGrow = false, onInput, ...rest },
  ref,
) {
  const autoId = useId();
  const inner = useRef<HTMLTextAreaElement | null>(null);
  const setRef = useCallback(
    (el: HTMLTextAreaElement | null) => {
      inner.current = el;
      if (typeof ref === 'function') ref(el);
      else if (ref) ref.current = el;
    },
    [ref],
  );
  const grow = useCallback(() => {
    const el = inner.current;
    if (!autoGrow || !el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [autoGrow]);
  useLayoutEffect(grow, [grow, rest.value]);

  return (
    <FormField id={id ?? autoId} label={label} hint={hint} error={error} className={className}>
      {({ inputId, describedBy, invalid }) => (
        <textarea
          ref={setRef}
          id={inputId}
          rows={rows}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          className={controlClass(error, autoGrow ? 'resize-none overflow-hidden' : '')}
          onInput={(e) => {
            grow();
            onInput?.(e);
          }}
          {...rest}
        />
      )}
    </FormField>
  );
});

export default Textarea;
