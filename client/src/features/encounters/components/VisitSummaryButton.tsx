import PdfButton from '../../billing/components/PdfButton';

/**
 * "Visit summary" (spec §12.3, Phase 10): the patient-safe visit summary PDF of a signed note,
 * made on demand by the server for the patient and their doctors (audited there).
 */
export default function VisitSummaryButton({
  encounterId,
  encounterNumber,
}: {
  encounterId: string;
  encounterNumber: string | null;
}) {
  return (
    <PdfButton
      url={`/encounters/${encounterId}/visit-summary.pdf`}
      fileName={`visit-summary-${encounterNumber ?? encounterId}.pdf`}
      label="Visit summary"
    />
  );
}
