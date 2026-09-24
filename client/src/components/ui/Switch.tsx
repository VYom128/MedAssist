import { Description, Field, Label, Switch as HeadlessSwitch } from '@headlessui/react';
import type { ReactNode } from 'react';

/**
 * On/off toggle (Headless UI Switch, `role="switch"`) with a label and optional description.
 * Only the switch itself toggles; the label text does not.
 */
export default function Switch({
  label,
  description,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  description?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Field disabled={disabled} className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <Label passive className="text-sm font-medium text-ink">
          {label}
        </Label>
        {description && (
          <Description as="div" className="mt-0.5 text-xs text-muted">
            {description}
          </Description>
        )}
      </div>
      <HeadlessSwitch
        checked={checked}
        onChange={onChange}
        className="group relative inline-flex h-6 w-11 shrink-0 after:absolute after:inset-x-0 after:-inset-y-2.5 cursor-pointer items-center rounded-full bg-line-control transition-colors duration-200 ease-standard focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 data-checked:bg-primary-600 data-disabled:cursor-not-allowed data-disabled:opacity-50"
      >
        <span
          aria-hidden="true"
          className="inline-block h-5 w-5 translate-x-0.5 rounded-full bg-white shadow-card transition-transform duration-200 ease-standard group-data-checked:translate-x-5.5"
        />
      </HeadlessSwitch>
    </Field>
  );
}
