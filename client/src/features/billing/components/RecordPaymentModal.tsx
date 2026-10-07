import { useState } from 'react';
import toast from 'react-hot-toast';
import Alert from '../../../components/ui/Alert';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Modal from '../../../components/ui/Modal';
import MoneyInput from '../../../components/ui/MoneyInput';
import Select from '../../../components/ui/Select';
import {
  BILLING_RULES,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  PAYMENT_METHODS_NEEDING_REFERENCE,
  optionsOf,
  type PaymentMethod,
} from '../../../constants/catalog';
import { getQueryErrorMessage, isApiQueryError } from '../../../utils/http';
import { formatINR } from '../../../utils/money';
import { useRecordPaymentMutation, type Invoice } from '../api';

const REFERENCE_LABELS: Partial<Record<PaymentMethod, string>> = {
  card: 'Card slip number',
  upi: 'UPI transaction ID',
  insurance: 'Claim number',
};

/**
 * Record a payment (reception): the amount defaults to the balance; the method comes from the
 * clinic's enabled methods; card, UPI and insurance need a reference. A balance or conflict error
 * from the server is shown here, and the invoice is refreshed behind the dialog. The parent gives
 * it a new `key` each time it opens.
 */
export default function RecordPaymentModal({
  invoice,
  open,
  onClose,
}: {
  invoice: Pick<Invoice, 'id' | 'invoiceNumber' | 'balancePaise' | 'rules'>;
  open: boolean;
  onClose: () => void;
}) {
  const methods = invoice.rules?.paymentMethods.length
    ? invoice.rules.paymentMethods
    : [...PAYMENT_METHODS];
  const [amount, setAmount] = useState<number | null>(invoice.balancePaise);
  const [method, setMethod] = useState<PaymentMethod>(methods[0] ?? 'cash');
  const [reference, setReference] = useState('');
  const [errors, setErrors] = useState<{ amount?: string; reference?: string }>({});
  const [serverError, setServerError] = useState<{ title?: string; message: string } | null>(null);
  const [record, { isLoading }] = useRecordPaymentMutation();
  const needsReference = PAYMENT_METHODS_NEEDING_REFERENCE.includes(method);

  const submit = async () => {
    const next: typeof errors = {};
    if (amount === null || Number.isNaN(amount)) next.amount = 'Enter the amount received';
    else if (amount <= 0) next.amount = 'The amount must be more than ₹0';
    else if (amount > invoice.balancePaise) {
      next.amount = `At most the balance of ${formatINR(invoice.balancePaise)}`;
    }
    if (needsReference && !reference.trim()) {
      next.reference = `Enter the ${REFERENCE_LABELS[method]?.toLowerCase() ?? 'reference'}`;
    }
    setErrors(next);
    setServerError(null);
    if (Object.keys(next).length > 0 || amount === null) return;
    try {
      const res = await record({
        invoiceId: invoice.id,
        amountPaise: amount,
        method,
        ...(reference.trim() ? { reference: reference.trim() } : {}),
      }).unwrap();
      toast.success(`${formatINR(amount)} received – ${res.payment.paymentNumber}`);
      onClose();
    } catch (err) {
      if (isApiQueryError(err) && err.code === 'PAYMENT_EXCEEDS_BALANCE') {
        const balance = (err.details as { balancePaise?: number } | undefined)?.balancePaise;
        setServerError({
          title: 'More than the balance',
          message:
            balance === undefined
              ? err.message
              : balance === 0
                ? 'This invoice is already fully paid.'
                : `Only ${formatINR(balance)} is still due. The invoice has been refreshed.`,
        });
        if (balance !== undefined) setAmount(balance);
      } else if (isApiQueryError(err) && err.code === 'CONFLICT') {
        setServerError({
          title: 'The invoice just changed',
          message:
            'Someone else updated this invoice. It has been refreshed – check the balance and try again.',
        });
      } else {
        setServerError({ message: getQueryErrorMessage(err) });
      }
    }
  };

  return (
    <Modal
      open={open}
      title={`Record payment${invoice.invoiceNumber ? ` – ${invoice.invoiceNumber}` : ''}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={isLoading}>
            Record payment
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {serverError && (
          <Alert tone="error" title={serverError.title}>
            {serverError.message}
          </Alert>
        )}
        <p className="text-sm text-muted">
          Balance due:{' '}
          <span className="tabular font-semibold text-ink">{formatINR(invoice.balancePaise)}</span>
        </p>
        <MoneyInput
          label="Amount received"
          value={amount}
          onChange={setAmount}
          error={errors.amount}
        />
        <Select
          label="Method"
          options={optionsOf(methods, PAYMENT_METHOD_LABELS)}
          value={method}
          onChange={(e) => {
            setMethod(e.target.value as PaymentMethod);
            setErrors((prev) => ({ ...prev, reference: undefined }));
          }}
        />
        {(needsReference || method === 'other') && (
          <Input
            label={REFERENCE_LABELS[method] ?? 'Reference (optional)'}
            value={reference}
            maxLength={BILLING_RULES.referenceMax}
            onChange={(e) => setReference(e.target.value)}
            error={errors.reference}
            hint={needsReference ? 'Required for this method.' : undefined}
          />
        )}
      </div>
    </Modal>
  );
}
