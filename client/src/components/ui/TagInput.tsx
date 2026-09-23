import { X } from 'lucide-react';
import { useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import { controlClass } from './controlClass';
import FormField from './FormField';

/**
 * A list of short strings (qualifications, languages). Enter or comma adds the typed text;
 * Backspace on an empty box removes the last tag. Duplicates are ignored.
 */
export default function TagInput({
  label,
  value,
  onChange,
  placeholder = 'Type and press Enter',
  error,
  hint,
  maxTags = 10,
  maxLength = 60,
  disabled = false,
}: {
  label: string;
  value: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  error?: string;
  hint?: ReactNode;
  maxTags?: number;
  maxLength?: number;
  disabled?: boolean;
}) {
  const id = useId();
  const [text, setText] = useState('');

  const add = () => {
    const tag = text.trim().replace(/,$/, '').trim();
    if (
      tag &&
      !value.some((t) => t.toLowerCase() === tag.toLowerCase()) &&
      value.length < maxTags
    ) {
      onChange([...value, tag.slice(0, maxLength)]);
    }
    setText('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add();
    } else if (e.key === 'Backspace' && text === '' && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <FormField id={id} label={label} hint={hint} error={error}>
      {({ inputId, describedBy, invalid }) => (
        <div className={`${controlClass(error)} flex flex-wrap items-center gap-1.5 py-1.5`}>
          {value.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700"
            >
              {tag}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => onChange(value.filter((t) => t !== tag))}
                  aria-label={`Remove ${tag}`}
                  className="rounded-full p-0.5 text-slate-500 hover:bg-slate-200 focus-visible:outline-2 focus-visible:outline-brand-600"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              )}
            </span>
          ))}
          <input
            id={inputId}
            aria-invalid={invalid}
            aria-describedby={describedBy}
            value={text}
            disabled={disabled || value.length >= maxTags}
            placeholder={value.length >= maxTags ? `At most ${maxTags}` : placeholder}
            maxLength={maxLength}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            onBlur={add}
            className="min-w-[8rem] flex-1 border-0 bg-transparent p-0.5 text-sm outline-none"
          />
        </div>
      )}
    </FormField>
  );
}
