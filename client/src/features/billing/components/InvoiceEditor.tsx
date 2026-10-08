import { CloudCheck, FileCheck2, ListPlus, Loader2, RotateCcw, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import Alert from '../../../components/ui/Alert';
import Button from '../../../components/ui/Button';
import ConfirmDialog from '../../../components/ui/ConfirmDialog';
import EmptyState from '../../../components/ui/EmptyState';
import Input from '../../../components/ui/Input';
import SectionCard from '../../../components/ui/SectionCard';
import Textarea from '../../../components/ui/Textarea';
import { BILLING_RULES } from '../../../constants/catalog';
import { useUnsavedChanges } from '../../../hooks/useUnsavedChanges';
import { getQueryErrorMessage } from '../../../utils/http';
import { formatINR } from '../../../utils/money';
import { useIssueInvoiceMutation, useLazyGetInvoiceQuery, type Invoice } from '../api';
import { discountPercentOf } from '../calc';
import { useInvoiceDraft } from '../useInvoiceDraft';
import AddLinePanel from './AddLinePanel';
import InvoiceTotals from './InvoiceTotals';
import LineRow from './LineRow';

/** "Saving…" / "Unsaved changes" / "Saved". */
function SaveState({ saving, dirty }: { saving: boolean; dirty: boolean }) {
  return (
    <p role="status" className="flex items-center gap-1.5 text-sm text-muted">
      {saving ? (
        <>
          <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" /> Saving…
        </>
      ) : dirty ? (
        'Unsaved changes'
      ) : (
        <>
          <CloudCheck className="h-4 w-4" aria-hidden="true" /> Saved
        </>
      )}
    </p>
  );
}

/**
 * The draft invoice editor (reception, admin): lines (add from a service, a lab test or "Other";
 * quantity, price, discount in ₹ or %; remove and reorder), live totals preview, notes and due
 * date, autosave with the revision (see useInvoiceDraft) and "Issue invoice". After a save the
 * server's totals are shown.
 */
export default function InvoiceEditor({ invoice }: { invoice: Invoice }) {
  const draft = useInvoiceDraft(invoice);
  const [confirmIssue, setConfirmIssue] = useState(false);
  const [issue, issuing] = useIssueInvoiceMutation();
  const [reload, reloading] = useLazyGetInvoiceQuery();
  const rules = invoice.rules;
  const taxLabel = rules?.taxLabel ?? 'Tax';
  const leaveDialog = useUnsavedChanges(draft.dirty);
  const { save } = draft;

  // Ctrl/⌘+S saves now.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);

  const reloadLatest = async () => {
    const fresh = await reload(invoice.id).unwrap();
    draft.reset(fresh);
  };

  const showPreview = draft.dirty || draft.saving;
  const totals = showPreview ? draft.preview : draft.server;
  const overLimit =
    draft.preview && rules
      ? discountPercentOf(draft.preview) > rules.maxDiscountPercentWithoutAdmin
      : false;
  const canIssue =
    !draft.dirty && !draft.saving && !draft.block && draft.rows.length > 0 && draft.valid;

  const move = (index: number, delta: -1 | 1) =>
    draft.setRows((rows) => {
      const next = [...rows];
      const [row] = next.splice(index, 1);
      next.splice(index + delta, 0, row!);
      return next;
    });

  return (
    <div className="space-y-6">
      {leaveDialog}
      {draft.block && (
        <Alert
          tone="warning"
          title={
            draft.block.kind === 'conflict'
              ? 'This invoice was changed by someone else'
              : 'This invoice can no longer be edited'
          }
        >
          <p>
            {draft.block.kind === 'conflict'
              ? 'Your last changes were not saved. Reload the latest version and make them again.'
              : draft.block.message}
          </p>
          <Button
            size="sm"
            variant="secondary"
            className="mt-2"
            loading={reloading.isFetching}
            onClick={() => void reloadLatest()}
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" /> Reload latest
          </Button>
        </Alert>
      )}
      {draft.discountLimit !== null && (
        <Alert tone="error" title="Discount needs an admin">
          An admin must approve a discount above {draft.discountLimit}% of the bill. Lower the
          discount, or ask an admin to save it.
        </Alert>
      )}
      {draft.error && <Alert tone="error">{draft.error}</Alert>}

      <SectionCard
        title="Lines"
        icon={ListPlus}
        actions={<SaveState saving={draft.saving} dirty={draft.dirty} />}
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              variant="secondary"
              disabled={!draft.dirty || draft.saving || Boolean(draft.block) || !draft.valid}
              onClick={() => void draft.save()}
            >
              <Save className="h-4 w-4" aria-hidden="true" /> Save now
            </Button>
            <Button disabled={!canIssue} onClick={() => setConfirmIssue(true)}>
              <FileCheck2 className="h-4 w-4" aria-hidden="true" /> Issue invoice
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          {draft.rows.length === 0 ? (
            <EmptyState
              icon={ListPlus}
              title="No lines yet"
              description="Add a service, a lab test or another charge below."
            />
          ) : (
            <ol className="space-y-3" aria-label="Invoice lines">
              {draft.rows.map((row, index) => (
                <LineRow
                  key={row.key}
                  row={row}
                  index={index}
                  count={draft.rows.length}
                  errors={draft.errorsFor(row.key)}
                  taxLabel={taxLabel}
                  onChange={(patch) =>
                    draft.setRows((rows) =>
                      rows.map((r) => (r.key === row.key ? { ...r, ...patch } : r)),
                    )
                  }
                  onMove={(delta) => move(index, delta)}
                  onRemove={() => draft.setRows((rows) => rows.filter((r) => r.key !== row.key))}
                />
              ))}
            </ol>
          )}
          {draft.rows.length < BILLING_RULES.maxLines && (
            <AddLinePanel
              defaultTaxRateBps={rules?.defaultTaxRateBps ?? 0}
              onAdd={(row) => draft.setRows((rows) => [...rows, row])}
            />
          )}
          {totals ? (
            <InvoiceTotals {...totals} taxLabel={taxLabel} preview={showPreview} />
          ) : (
            <p className="text-right text-sm text-muted">Fix the lines to see the totals.</p>
          )}
          {overLimit && rules && (
            <p className="text-right text-sm text-warning-700">
              The discount is above {rules.maxDiscountPercentWithoutAdmin}% – an admin must approve
              it.
            </p>
          )}
        </div>
      </SectionCard>

      <SectionCard title="Notes and due date">
        <div className="grid gap-4 sm:grid-cols-3">
          <Textarea
            label="Notes"
            className="sm:col-span-2"
            maxLength={BILLING_RULES.notesMax}
            hint="Shown to staff only."
            value={draft.notes}
            onChange={(e) => draft.setNotes(e.target.value)}
          />
          <Input
            label="Due date"
            type="date"
            hint="Defaults to the issue date."
            value={draft.dueDate}
            onChange={(e) => draft.setDueDate(e.target.value)}
          />
        </div>
      </SectionCard>

      <ConfirmDialog
        open={confirmIssue}
        title="Issue this invoice?"
        confirmLabel="Issue invoice"
        loading={issuing.isLoading}
        onCancel={() => setConfirmIssue(false)}
        onConfirm={() =>
          void issue({ id: invoice.id, expectedVersion: draft.revision })
            .unwrap()
            .then((issued) => {
              toast.success(`Invoice ${issued.invoiceNumber ?? ''} issued`);
              setConfirmIssue(false);
            })
            .catch((err: unknown) => {
              setConfirmIssue(false);
              toast.error(getQueryErrorMessage(err));
            })
        }
      >
        <p>
          After issuing, the invoice can&apos;t be edited. It gets its number and the patient can
          see it. Total:{' '}
          <span className="tabular font-semibold">{formatINR(draft.server.totalPaise)}</span>
        </p>
      </ConfirmDialog>
    </div>
  );
}
