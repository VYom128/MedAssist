import PdfButton from '../../billing/components/PdfButton';

/**
 * "Download slip" (spec §12.3, Phase 10): the appointment slip PDF, made on demand by the server
 * for reception, admins and the patient (audited there).
 */
export default function SlipButton({
  appointment,
}: {
  appointment: { id: string; appointmentNumber: string };
}) {
  return (
    <PdfButton
      url={`/appointments/${appointment.id}/slip.pdf`}
      fileName={`slip-${appointment.appointmentNumber}.pdf`}
      label="Download slip"
    />
  );
}
