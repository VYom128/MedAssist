import {
  Combobox,
  ComboboxInput,
  ComboboxOption,
  ComboboxOptions,
  Field,
  Label,
} from '@headlessui/react';
import { Search } from 'lucide-react';
import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import Avatar from '../../../components/ui/Avatar';
import Button from '../../../components/ui/Button';
import Code from '../../../components/ui/Code';
import { controlClass } from '../../../components/ui/controlClass';
import { linkClass } from '../../../components/ui/linkClass';
import { GENDER_SHORT } from '../../../constants/catalog';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { formatPhone } from '../../../utils/phone';
import { useListPatientsQuery, type PatientListItem } from '../api';
import { ageSex } from '../paths';

/**
 * Pick a patient by MRN, phone or name as you type (GET /patients search, spec §12.1). Once
 * chosen, shows the patient with a "Change" button. `registerHref` adds a "Register new patient"
 * link for reception.
 */
export default function PatientPicker({
  value,
  onChange,
  label = 'Patient',
  error,
  registerHref,
}: {
  value: PatientListItem | null;
  onChange: (patient: PatientListItem | null) => void;
  label?: string;
  error?: string;
  registerHref?: string;
}) {
  const [query, setQuery] = useState('');
  const term = useDebouncedValue(query.trim(), 250);
  const errorId = useId();
  const { data, isFetching } = useListPatientsQuery(
    { q: term, limit: 8, sort: 'lastName' },
    { skip: term.length < 2 },
  );
  const results = term.length >= 2 ? (data?.items ?? []) : [];

  if (value) {
    return (
      <div>
        <p className="text-sm font-medium text-ink">{label}</p>
        <div className="mt-1.5 flex items-center justify-between gap-3 rounded-control border border-line bg-surface-muted p-3">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar name={value.fullName} size="md" />
            <div className="min-w-0 text-sm">
              <p className="font-semibold text-ink">{value.fullName}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-2 text-muted">
                <Code>{value.mrn}</Code>
                <span className="tabular">{ageSex(value.age, GENDER_SHORT[value.gender])}</span>
                <span className="tabular">{formatPhone(value.phone)}</span>
              </p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => onChange(null)}>
            Change
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Field>
      <Label className="text-sm font-medium text-ink">{label}</Label>
      <Combobox value={null} onChange={(p: PatientListItem | null) => p && onChange(p)}>
        <div className="relative mt-1.5">
          <ComboboxInput
            className={controlClass(error, 'pr-10!')}
            placeholder="MRN, phone or name"
            autoComplete="off"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? errorId : undefined}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Search
            className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-subtle"
            aria-hidden="true"
          />
          {term.length >= 2 && (
            <ComboboxOptions
              static
              className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-control border border-line bg-surface p-1 shadow-overlay"
            >
              {isFetching && results.length === 0 && (
                <div className="px-3 py-2 text-sm text-muted">Searching…</div>
              )}
              {!isFetching && results.length === 0 && (
                <div className="px-3 py-2 text-sm text-muted">No patients found</div>
              )}
              {results.map((p) => (
                <ComboboxOption
                  key={p.id}
                  value={p}
                  className="flex cursor-pointer items-center gap-3 rounded-control px-3 py-2 text-sm data-focus:bg-primary-50"
                >
                  <Avatar name={p.fullName} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-ink">{p.fullName}</span>
                    <span className="block text-xs text-muted">
                      {p.mrn} · {ageSex(p.age, GENDER_SHORT[p.gender])} · {formatPhone(p.phone)}
                    </span>
                  </span>
                </ComboboxOption>
              ))}
            </ComboboxOptions>
          )}
        </div>
      </Combobox>
      {error && (
        <p id={errorId} className="mt-1.5 text-sm text-danger-700" role="alert">
          {error}
        </p>
      )}
      {registerHref && (
        <p className="mt-1.5 text-sm text-muted">
          Not registered yet?{' '}
          <Link to={registerHref} className={linkClass}>
            Register new patient
          </Link>
        </p>
      )}
    </Field>
  );
}
