import type { LabResult } from '../api';
import { formatResultValue, isAbnormalFlag } from '../format';
import { LabFlagPill } from './LabBadges';

/**
 * Results of one test, read-only (spec §12.3 layout): parameter, value (bold when out of range),
 * unit, reference and flag. A table from `sm`; stacked rows on phones.
 */
export default function ResultsTable({
  results,
  caption,
  audience = 'staff',
}: {
  results: LabResult[];
  caption: string;
  /** 'patient' words critical flags for patients. */
  audience?: 'staff' | 'patient';
}) {
  if (results.length === 0) return <p className="text-sm text-muted">No results yet.</p>;
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">{caption}</caption>
      <thead className="hidden text-left text-xs text-muted sm:table-header-group">
        <tr>
          <th scope="col" className="py-1.5 pr-3 font-semibold">
            Parameter
          </th>
          <th scope="col" className="py-1.5 pr-3 font-semibold">
            Result
          </th>
          <th scope="col" className="py-1.5 pr-3 font-semibold">
            Reference
          </th>
          <th scope="col" className="py-1.5 font-semibold">
            Flag
          </th>
        </tr>
      </thead>
      <tbody>
        {results.map((r) => {
          const abnormal = isAbnormalFlag(r.flag);
          return (
            <tr
              key={r.parameterKey}
              className="grid grid-cols-[1fr_auto] gap-x-3 border-t border-line py-2 sm:table-row sm:py-0"
            >
              <th scope="row" className="text-left font-medium text-ink sm:py-2 sm:pr-3">
                {r.name}
              </th>
              <td
                className={`text-right tabular sm:py-2 sm:pr-3 sm:text-left ${abnormal ? 'font-bold text-ink' : 'text-ink'}`}
              >
                {formatResultValue(r.value)}
                {r.unit ? <span className="ml-1 font-normal text-muted">{r.unit}</span> : null}
              </td>
              <td className="text-xs text-muted sm:py-2 sm:pr-3 sm:text-sm">
                {r.referenceText ?? ''}
              </td>
              <td className="text-right sm:py-2 sm:text-left">
                <LabFlagPill flag={r.flag} audience={audience} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
