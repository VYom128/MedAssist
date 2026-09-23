import { forwardRef, useState, type ComponentProps } from 'react';
import Input from '../../../components/ui/Input';

type PasswordFieldProps = Omit<ComponentProps<typeof Input>, 'type' | 'trailing'>;

/** Password input with a show/hide toggle. */
const PasswordField = forwardRef<HTMLInputElement, PasswordFieldProps>(
  function PasswordField(props, ref) {
    const [visible, setVisible] = useState(false);
    return (
      <Input
        ref={ref}
        type={visible ? 'text' : 'password'}
        trailing={
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            className="rounded px-2 py-1 text-xs font-medium text-slate-500 hover:text-slate-800"
            aria-label={visible ? 'Hide password' : 'Show password'}
          >
            {visible ? 'Hide' : 'Show'}
          </button>
        }
        {...props}
      />
    );
  },
);

export default PasswordField;
