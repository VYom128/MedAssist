import { TriangleAlert } from 'lucide-react';
import type { Prescription } from '../api';
import { itemLine } from '../format';

/**
 * The drugs of a prescription, read-only, with allergy warnings (doctor view). Each row has an
 * id (`rx-item-<n>`) so sign problems can point at it.
 */
export default function PrescriptionItems({ prescription }: { prescription: Prescription }) {
  if (prescription.items.length === 0) {
    return <p className="text-sm text-muted">No drugs on this prescription.</p>;
  }
  return (
    <ol id="rx-items" className="space-y-2" aria-label="Prescribed drugs">
      {prescription.items.map((item, i) => {
        const warning = item.allergyWarning;
        return (
          <li
            key={i}
            id={`rx-item-${i}`}
            tabIndex={-1}
            className={`rounded-control border px-3 py-2 focus-visible:outline-2 focus-visible:outline-primary-600 ${
              warning && !warning.acknowledged ? 'border-danger-500 bg-danger-50' : 'border-line'
            }`}
          >
            <p className="text-sm font-semibold text-ink">
              {i + 1}. {item.drugName}
              {item.strength ? ` ${item.strength}` : ''}
              {item.genericName && item.genericName !== item.drugName && (
                <span className="font-normal text-muted"> ({item.genericName})</span>
              )}
            </p>
            <p className="text-sm text-muted">{itemLine(item) || 'Dose and frequency not set'}</p>
            {item.instructions && <p className="text-sm text-ink">{item.instructions}</p>}
            {warning && (
              <p
                className={`mt-1 inline-flex items-center gap-1.5 text-xs font-semibold ${
                  warning.acknowledged ? 'text-warning-700' : 'text-danger-700'
                }`}
              >
                <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />
                Matches the recorded allergy “{warning.substance}”
                {warning.drugClass ? ` (${warning.drugClass})` : ''} –{' '}
                {warning.acknowledged ? 'acknowledged' : 'not acknowledged'}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
