import {
  Combobox,
  ComboboxInput,
  ComboboxOption,
  ComboboxOptions,
  Field,
  Label,
} from '@headlessui/react';
import { useId, useState } from 'react';
import { controlClass } from '../../../components/ui/controlClass';
import { RX_TEXT_LIMITS } from '../../../constants/catalog';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { useSearchFormularyQuery, type FormularyDrug } from '../api';

/**
 * Drug name with suggestions from the local formulary (GET /formulary). Free text is allowed
 * (drugs outside the formulary); picking a suggestion also fills the generic name and hints.
 */
export default function DrugNameInput({
  value,
  error,
  onText,
  onPick,
  onBlur,
}: {
  value: string;
  error?: string;
  onText: (text: string) => void;
  onPick: (drug: FormularyDrug) => void;
  onBlur?: () => void;
}) {
  const [query, setQuery] = useState('');
  const term = useDebouncedValue(query.trim(), 200);
  const errorId = useId();
  const { data } = useSearchFormularyQuery({ q: term, limit: 8 }, { skip: term.length < 2 });
  const results = term.length >= 2 ? (data ?? []) : [];

  return (
    <Field>
      <Label className="text-sm font-medium text-ink">Drug</Label>
      <Combobox<FormularyDrug | null>
        value={null}
        onChange={(drug) => {
          if (drug) {
            setQuery('');
            onPick(drug);
          }
        }}
      >
        <div className="relative mt-1.5">
          <ComboboxInput
            className={controlClass(error)}
            autoComplete="off"
            maxLength={RX_TEXT_LIMITS.drugName}
            placeholder="Type to search the formulary"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? errorId : undefined}
            displayValue={() => value}
            onChange={(e) => {
              setQuery(e.target.value);
              onText(e.target.value);
            }}
            onBlur={onBlur}
          />
          {results.length > 0 && (
            <ComboboxOptions
              anchor="bottom start"
              className="z-50 max-h-72 w-(--input-width) overflow-y-auto rounded-control border border-line bg-surface p-1 shadow-overlay empty:invisible"
            >
              {results.map((d) => (
                <ComboboxOption
                  key={d.name}
                  value={d}
                  className="cursor-pointer rounded-control px-3 py-2 text-sm data-focus:bg-primary-50"
                >
                  <span className="block font-medium text-ink">{d.name}</span>
                  <span className="block text-xs text-muted">
                    {d.genericName} · {d.strengths.join(', ')}
                  </span>
                </ComboboxOption>
              ))}
            </ComboboxOptions>
          )}
        </div>
      </Combobox>
      {error && (
        <p id={errorId} className="mt-1.5 text-sm text-danger-700">
          {error}
        </p>
      )}
    </Field>
  );
}
