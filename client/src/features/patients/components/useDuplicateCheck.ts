import { useEffect, useMemo } from 'react';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { useLazyCheckDuplicateQuery, type DuplicateMatch } from '../api';
import { duplicateCriteria } from '../schemas';

/**
 * Runs GET /patients/check-duplicate once phone + DOB or name + DOB are filled in (debounced).
 * @param enabled false to skip (e.g. an edit where phone and DOB are unchanged)
 * @param excludeId the record being edited, which always "matches" itself
 */
export function useDuplicateCheck(
  values: { firstName: string; lastName: string; dateOfBirth: string; phone: string },
  { enabled = true, excludeId }: { enabled?: boolean; excludeId?: string } = {},
): DuplicateMatch[] {
  const criteria = useMemo(
    () => (enabled ? duplicateCriteria(values) : null),
    [enabled, values.firstName, values.lastName, values.dateOfBirth, values.phone], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const key = useDebouncedValue(criteria ? JSON.stringify(criteria) : '', 500);
  const [check, { data }] = useLazyCheckDuplicateQuery();

  useEffect(() => {
    if (key) void check(JSON.parse(key) as NonNullable<typeof criteria>, true);
  }, [key, check]);

  if (!key || !data) return [];
  return data.matches.filter((m) => m.id !== excludeId);
}
