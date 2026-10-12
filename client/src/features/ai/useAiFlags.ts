import { useGetPublicSettingsQuery } from '../settings/api';

/**
 * The clinic's AI kill switches from the public settings (loaded at app start). Everything is
 * off until they load, so no AI button flashes up and disappears.
 */
export function useAiFlags() {
  const { data } = useGetPublicSettingsQuery();
  const ai = data?.ai;
  return {
    clinicalSummary: Boolean(ai?.enabled && ai.clinicalSummaryEnabled),
    patientExplanation: Boolean(ai?.enabled && ai.patientExplanationEnabled),
    languages: ai?.explanationLanguages ?? [],
    clinicPhone: data?.phone ?? null,
  };
}
