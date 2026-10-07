import { Ban } from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import Button from '../../../components/ui/Button';
import ReasonDialog from '../../../components/ui/ReasonDialog';
import { BILLING_RULES } from '../../../constants/catalog';
import { getQueryErrorMessage } from '../../../utils/http';
import { formatINR } from '../../../utils/money';
import { useVoidInvoiceMutation, type Invoice } from '../api';

/**
 * "Void invoice" with a reason. While money is held on the invoice (net of refunds) the button is
 * disabled and says why – refund first (the server refuses with VOID_REQUIRES_REFUND anyway).
 */
export default function VoidInvoiceButton({
  invoice,
}: {
  invoice: Pick<Invoice, 'id' | 'invoiceNumber' | 'amountPaidPaise'>;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voidInvoice, { isLoading }] = useVoidInvoiceMutation();
  const held = invoice.amountPaidPaise > 0;
  const hintId = `void-hint-${invoice.id}`;

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        size="sm"
        variant="softDanger"
        disabled={held}
        aria-describedby={held ? hintId : undefined}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        <Ban className="h-4 w-4" aria-hidden="true" /> Void invoice
      </Button>
      {held && (
        <p id={hintId} className="text-xs text-muted">
          {formatINR(invoice.amountPaidPaise)} is still paid on this invoice. Refund it before
          voiding.
        </p>
      )}
      <ReasonDialog
        open={open}
        title={`Void ${invoice.invoiceNumber ?? 'this draft'}?`}
        confirmLabel="Void invoice"
        tone="danger"
        minLength={BILLING_RULES.voidReasonMin}
        loading={isLoading}
        error={error}
        onCancel={() => setOpen(false)}
        onSubmit={(reason) =>
          void voidInvoice({ id: invoice.id, reason })
            .unwrap()
            .then(() => {
              toast.success('Invoice voided');
              setOpen(false);
            })
            .catch((err: unknown) => setError(getQueryErrorMessage(err)))
        }
      >
        <p>A void invoice stays on record with its number but nothing is due on it.</p>
      </ReasonDialog>
    </div>
  );
}
