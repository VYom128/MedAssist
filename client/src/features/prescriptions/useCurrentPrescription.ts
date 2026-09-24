import { skipToken } from '@reduxjs/toolkit/query';
import { useGetPrescriptionQuery, useListPrescriptionsQuery } from './api';

/**
 * The current prescription of a note (one per encounter: the draft, or the issued one; a
 * cancelled one is no longer current). `undefined` encounter = nothing loaded.
 */
export function useCurrentPrescription(encounterId: string | undefined) {
  const list = useListPrescriptionsQuery(
    encounterId ? { encounter: encounterId, limit: 20 } : skipToken,
  );
  const current = list.data?.items.find((p) => p.isCurrent) ?? null;
  const one = useGetPrescriptionQuery(current ? current.id : skipToken);
  return {
    prescription: current ? (one.data ?? null) : null,
    isLoading: list.isLoading || (Boolean(current) && one.isLoading),
    isError: list.isError || one.isError,
    error: list.error ?? one.error,
    refetch: () => {
      void list.refetch();
      if (current) void one.refetch();
    },
  };
}
