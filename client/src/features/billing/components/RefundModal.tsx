import { useState } from 'react';
import toast from 'react-hot-toast';
import Alert from '../../../components/ui/Alert';
import Button from '../../../components/ui/Button';
import Modal from '../../../components/ui/Modal';
import MoneyInput from '../../../components/ui/MoneyInput';
import Textarea from '../../../components/ui/Textarea';
import { BILLING_RULES, PAYMENT_METHOD_LABELS } from '../../../constants/catalog';
import { getQueryErrorMessage, isApiQueryError } from '../../../utils/http';
import { formatINR } from '../../../utils/money';
import { useRefundPaymentMutation, type Payment } from '../api';

/**
 * Refund (part of) a payment: at most what is left of it (the payment minus earlier refunds),
 * with a reason. The parent gives it a new `key` each time it opens.
 */
export default function RefundModal({
  payment,
  open,
  onClose,
  suggestedPaise,
}: {
  payment: Payment;
  open: boolean;
  onClose: () => void;
  /** A suggested amount (e.g. the cancelled tests), capped at the refundable remainder. */
  suggestedPaise?: number;
}) {
  const max = payment.refundablePaise ?? payment.amountPaise;
  const [amount, setAmount] = useState<number | null>(
    suggestedPaise ? Math.min(suggestedPaise, max) : max,
  );
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<{ amount?: string; reason?: string }>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [refund, { isLoading }] = useRefundPaymentMutation();

  const submit = async () => {
    const next: typeof errors = {};
    if (amount === null || Number.isNaN(amount) || amount <= 0) {
      next.amount = 'Enter the amount to refund';
    } else if (amount > max) {
      next.amount = `At most ${formatINR(max)} can be refunded from this payment`;
    }
    if (reason.trim().length < BILLING_RULES.refundReasonMin) {
      next.reason = `At least ${BILLING_RULES.refundReasonMin} characters`;
    }
    setErrors(next);
    setServerError(null);
    if (Object.keys(next).length > 0 || amount === null) return;
    try {
      const res = await refund({
        paymentId: payment.id,
        invoiceId: payment.invoiceId,
        amountPaise: amount,
        reason: reason.trim(),
      }).unwrap();
      toast.success(`${formatINR(amount)} refunded – ${res.refund.paymentNumber}`);
      onClose();
    } catch (err) {
      if (isApiQueryError(err) && err.code === 'REFUND_EXCEEDS_PAYMENT') {
        const left = (err.details as { refundablePaise?: number } | undefined)?.refundablePaise;
        setServerError(
          left === undefined ? err.message : `Only ${formatINR(left)} is left to refund.`,
        );
      } else {
        setServerError(getQueryErrorMessage(err));
      }
    }
  };

  return (
    <Modal
      open={open}
      title={`Refund ${payment.paymentNumber}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => void submit()} loading={isLoading}>
            Refund
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {serverError && <Alert tone="error">{serverError}</Alert>}
        <p className="text-sm text-muted">
          {PAYMENT_METHOD_LABELS[payment.method]} payment of {formatINR(payment.amountPaise)}.
          Refundable:{' '}
          <span className="tabular font-semibold text-ink" data-testid="refundable">
            {formatINR(max)}
          </span>
        </p>
        <MoneyInput
          label="Amount to refund"
          value={amount}
          onChange={setAmount}
          error={errors.amount}
          hint={`Up to ${formatINR(max)}. Return it by the same method.`}
        />
        <Textarea
          label="Reason"
          value={reason}
          maxLength={BILLING_RULES.reasonMax}
          onChange={(e) => setReason(e.target.value)}
          error={errors.reason}
          hint="Printed on the refund receipt."
        />
      </div>
    </Modal>
  );
}
