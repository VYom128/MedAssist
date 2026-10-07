import { Info } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { useAppSelector } from '../../../app/hooks';
import Alert from '../../../components/ui/Alert';
import BackLink from '../../../components/ui/BackLink';
import Card from '../../../components/ui/Card';
import DescriptionList from '../../../components/ui/DescriptionList';
import ErrorState from '../../../components/ui/ErrorState';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import PageHeader from '../../../components/ui/PageHeader';
import StatusPill from '../../../components/ui/StatusPill';
import { linkClass } from '../../../components/ui/linkClass';
import { INVOICE_KIND_LABELS } from '../../../constants/catalog';
import { ROLES } from '../../../constants/roles';
import { formatCalendarDate, formatDate, formatDateTime } from '../../../utils/dates';
import { isApiQueryError } from '../../../utils/http';
import { selectCurrentUser } from '../../auth/authSlice';
import { patientsBase } from '../../patients/paths';
import { invoicePdfUrl, useGetInvoiceQuery } from '../api';
import InvoiceEditor from '../components/InvoiceEditor';
import InvoiceLockedView from '../components/InvoiceLockedView';
import PdfButton from '../components/PdfButton';
import VoidInvoiceButton from '../components/VoidInvoiceButton';
import { invoiceActions, invoicesBase } from '../paths';

/**
 * /reception/invoices/:id, /admin/invoices/:id and /patient/invoices/:id. A draft opens in the
 * editor (reception and admins); an issued invoice is locked: lines, totals, payments, balance,
 * Record payment / Refund / Void for the desk, the PDF for everyone. Patients see their own
 * issued invoices (the server never returns drafts to them) and a "pay at reception" note.
 */
export default function InvoiceDetailPage() {
  const { id = '' } = useParams();
  const user = useAppSelector(selectCurrentUser);
  const base = invoicesBase(user?.role);
  const isPatient = user?.role === ROLES.PATIENT;
  const { data: invoice, isLoading, isError, error, refetch } = useGetInvoiceQuery(id);

  if (isLoading) {
    return (
      <section className="mx-auto w-full max-w-5xl">
        <BackLink to={base} label="Invoices" />
        <ListSkeleton label="Loading invoice…" rows={4} />
      </section>
    );
  }
  if (isError || !invoice) {
    return (
      <section className="mx-auto w-full max-w-5xl">
        <BackLink to={base} label="Invoices" />
        {isApiQueryError(error) && error.status === 404 ? (
          <Alert tone="error">This invoice does not exist or is not available to you.</Alert>
        ) : (
          <ErrorState error={error} onRetry={() => void refetch()} />
        )}
      </section>
    );
  }

  const can = invoiceActions(user?.role, invoice);
  const visit = invoice.appointment;
  const due = !isPatient || invoice.status === 'void' ? false : invoice.balancePaise > 0;

  return (
    <section className="mx-auto w-full max-w-5xl">
      <PageHeader
        back={{ to: base, label: 'Invoices' }}
        eyebrow={`${INVOICE_KIND_LABELS[invoice.kind]} invoice`}
        title={invoice.invoiceNumber ?? 'Draft invoice'}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusPill domain="invoice" status={invoice.status} />
            <span>
              {invoice.patient.name}
              {invoice.patient.mrn ? ` · ${invoice.patient.mrn}` : ''}
            </span>
          </span>
        }
        actions={
          <div className="flex flex-wrap items-start gap-2">
            {can.pdf && (
              <PdfButton
                url={invoicePdfUrl(invoice.id)}
                fileName={`${invoice.invoiceNumber ?? 'invoice'}.pdf`}
                label="Download invoice"
              />
            )}
            {can.void && invoice.status !== 'void' && <VoidInvoiceButton invoice={invoice} />}
          </div>
        }
      />

      <div className="space-y-6">
        {due && (
          <Alert tone="info" title="Please pay at the clinic reception">
            Online payment is not available. You can pay the balance by cash, card or UPI at the
            front desk; your receipt will appear here.
          </Alert>
        )}
        {invoice.status === 'void' && (
          <Alert tone="info" title="This invoice is void">
            Voided {invoice.void ? formatDateTime(invoice.void.at) : ''}
            {!isPatient && invoice.void?.reason ? ` – ${invoice.void.reason}` : ''}. Nothing is due
            on it.
          </Alert>
        )}
        <Card>
          <DescriptionList
            columns={3}
            items={[
              {
                label: 'Patient',
                value:
                  !isPatient && invoice.patient.id ? (
                    <Link
                      to={`${patientsBase(user?.role)}/${invoice.patient.id}?tab=billing`}
                      className={linkClass}
                    >
                      {invoice.patient.name}
                    </Link>
                  ) : (
                    invoice.patient.name
                  ),
              },
              {
                label: 'Visit',
                value: visit
                  ? [
                      visit.appointmentNumber,
                      visit.doctorName && `Dr ${visit.doctorName}`,
                      visit.startAt && formatDate(visit.startAt),
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  : null,
              },
              {
                label: 'Issued',
                value: invoice.issuedAt ? formatDateTime(invoice.issuedAt) : 'Not yet',
              },
              {
                label: 'Due date',
                value: invoice.dueDate ? formatCalendarDate(invoice.dueDate) : null,
              },
              ...(isPatient
                ? []
                : [
                    { label: 'Issued by', value: invoice.issuedBy?.name },
                    {
                      label: 'Discount approved',
                      value: invoice.discountApproval
                        ? `${invoice.discountApproval.byName ?? 'Admin'}, ${formatDateTime(invoice.discountApproval.at)}`
                        : null,
                    },
                    ...(invoice.status !== 'draft'
                      ? [{ label: 'Notes', value: invoice.notes, wide: true }]
                      : []),
                  ]),
            ]}
          />
        </Card>

        {invoice.status === 'draft' && can.edit ? (
          <>
            {user?.role === ROLES.ADMIN && (
              <p className="flex items-start gap-2 text-sm text-muted">
                <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                As an admin you can approve discounts above the clinic&apos;s limit.
              </p>
            )}
            {/* A new key per revision from outside (reload) starts the editor fresh. */}
            <InvoiceEditor key={invoice.id} invoice={invoice} />
          </>
        ) : (
          <InvoiceLockedView invoice={invoice} />
        )}
      </div>
    </section>
  );
}
