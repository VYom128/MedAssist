import { Eye, EyeOff } from 'lucide-react';
import { forwardRef, useState } from 'react';
import Input, { type InputProps } from './Input';

type PasswordInputProps = Omit<InputProps, 'type' | 'trailing'>;

/** Password input with a show/hide toggle. */
const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput(props, ref) {
    const [visible, setVisible] = useState(false);
    const Icon = visible ? EyeOff : Eye;
    return (
      <Input
        ref={ref}
        type={visible ? 'text' : 'password'}
        trailing={
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-control text-muted transition-colors hover:bg-neutral-50 hover:text-ink focus-visible:outline-2 focus-visible:outline-primary-600"
            aria-label={visible ? 'Hide password' : 'Show password'}
            aria-pressed={visible}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
          </button>
        }
        {...props}
      />
    );
  },
);

export default PasswordInput;
