import { IdCard, ShieldCheck, UserX } from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { Link } from 'react-router-dom';
import PageHeader from '../../../components/PageHeader';
import Button from '../../../components/ui/Button';
import ConfirmDialog from '../../../components/ui/ConfirmDialog';
import EmptyState from '../../../components/ui/EmptyState';
import ErrorState from '../../../components/ui/ErrorState';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import Pagination from '../../../components/ui/Pagination';
import { useListParams } from '../../../hooks/useListParams';
import { formatCalendarDate, formatDateTime } from '../../../utils/dates';
import { getQueryErrorMessage } from '../../../utils/http';
import { formatPhone } from '../../../utils/phone';
import {
  useConfirmLinkMutation,
  usePendingLinksQuery,
  useRejectLinkMutation,
  type PendingLink,
} from '../api';
import ReasonDialog from '../components/ReasonDialog';

const PAGE_SIZE = 20;

function Row({ label, value, differs }: { label: string; value: string; differs?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className={`text-right font-medium break-all ${differs ? 'text-amber-700' : ''}`}>
        {value}
        {differs && <span className="sr-only"> (differs)</span>}
      </dd>
    </div>
  );
}

/** One sign-up next to the record it matched. */
function PendingCard({
  link,
  onConfirm,
  onReject,
}: {
  link: PendingLink;
  onConfirm: () => void;
  onReject: () => void;
}) {
  const { signup, patient } = link;
  const name = `${signup.firstName} ${signup.lastName}`;
  return (
    <li className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="grid gap-4 md:grid-cols-2">
        <section aria-label={`Sign-up by ${name}`}>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Online sign-up</h2>
          <dl className="space-y-1 text-sm">
            <Row label="Name" value={name} differs={patient ? patient.fullName !== name : false} />
            <Row label="Date of birth" value={formatCalendarDate(signup.dateOfBirth)} />
            <Row label="Phone" value={formatPhone(signup.phone)} />
            <Row label="Email" value={signup.email} />
            <Row label="Signed up" value={formatDateTime(signup.registeredAt)} />
          </dl>
        </section>
        <section aria-label="Matched patient record">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Matched patient record</h2>
          {patient ? (
            <dl className="space-y-1 text-sm">
              <Row label="Name" value={patient.fullName} />
              <Row label="MRN" value={patient.mrn} />
              <Row label="Date of birth" value={formatCalendarDate(patient.dateOfBirth)} />
              <Row label="Phone" value={formatPhone(patient.phone)} />
              <div className="pt-1 text-right">
                <Link
                  to={`/reception/patients/${patient.id}`}
                  className="font-medium text-brand-700 hover:underline"
                >
                  Open record
                </Link>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-slate-500">The matched record no longer exists.</p>
          )}
        </section>
      </div>
      {patient && (
        <div className="mt-4 flex flex-col gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onReject}>
            <UserX className="h-4 w-4" aria-hidden="true" /> Not this person
          </Button>
          <Button onClick={onConfirm}>
            <ShieldCheck className="h-4 w-4" aria-hidden="true" /> Confirm identity
          </Button>
        </div>
      )}
    </li>
  );
}

/**
 * /reception/pending-links (spec §4.4): online sign-ups whose phone and date of birth matched an
 * existing record. Reception checks photo ID, then confirms the link or rejects it (a separate
 * record is then created for the person).
 */
export default function PendingLinksPage() {
  const list = useListParams();
  const { data, isLoading, isFetching, isError, error, refetch } = usePendingLinksQuery({
    page: list.page,
    limit: PAGE_SIZE,
  });
  const [confirmLink, confirming] = useConfirmLinkMutation();
  const [rejectLink, rejecting] = useRejectLinkMutation();
  const [toConfirm, setToConfirm] = useState<PendingLink | null>(null);
  const [toReject, setToReject] = useState<PendingLink | null>(null);
  const [rejectError, setRejectError] = useState<string | null>(null);

  const confirm = async () => {
    if (!toConfirm?.patient) return;
    try {
      await confirmLink({ patientId: toConfirm.patient.id, userId: toConfirm.userId }).unwrap();
      toast.success(`${toConfirm.signup.firstName} can now see their records`);
    } catch (err) {
      toast.error(getQueryErrorMessage(err));
    } finally {
      setToConfirm(null);
    }
  };

  const reject = async (reason: string) => {
    if (!toReject?.patient) return;
    setRejectError(null);
    try {
      const created = await rejectLink({
        patientId: toReject.patient.id,
        userId: toReject.userId,
        reason,
      }).unwrap();
      toast.success(`Separate record created – ${created.mrn}`);
      setToReject(null);
    } catch (err) {
      setRejectError(getQueryErrorMessage(err));
    }
  };

  return (
    <section className="mx-auto w-full max-w-5xl">
      <PageHeader
        title="Pending verifications"
        description="Patients who signed up online and match an existing record. Check their photo ID before confirming."
      />
      {isLoading && <ListSkeleton label="Loading pending verifications…" rows={2} />}
      {isError && <ErrorState error={error} onRetry={() => void refetch()} />}
      {data && data.items.length === 0 && (
        <EmptyState
          icon={IdCard}
          title="Nothing to verify"
          description="Online sign-ups that match an existing patient appear here."
        />
      )}
      {data && data.items.length > 0 && (
        <div aria-busy={isFetching || undefined}>
          <ul className="space-y-4" aria-label="Pending verifications">
            {data.items.map((link) => (
              <PendingCard
                key={link.userId}
                link={link}
                onConfirm={() => setToConfirm(link)}
                onReject={() => setToReject(link)}
              />
            ))}
          </ul>
          <Pagination meta={data.meta} onPageChange={(p) => list.update({ page: String(p) })} />
        </div>
      )}

      <ConfirmDialog
        open={Boolean(toConfirm)}
        title="Confirm identity?"
        confirmLabel="Confirm and link"
        loading={confirming.isLoading}
        onConfirm={() => void confirm()}
        onCancel={() => setToConfirm(null)}
      >
        <p>
          Check a photo ID: the name and date of birth must match{' '}
          <strong>{toConfirm?.patient?.fullName}</strong> ({toConfirm?.patient?.mrn}).
        </p>
        <p className="mt-2">
          {toConfirm?.signup.firstName} will then see this patient's records in the portal. This
          cannot be undone from here.
        </p>
      </ConfirmDialog>

      <ReasonDialog
        open={Boolean(toReject)}
        title="Not this person?"
        confirmLabel="Create separate record"
        minLength={10}
        loading={rejecting.isLoading}
        error={rejectError}
        onCancel={() => {
          setToReject(null);
          setRejectError(null);
        }}
        onSubmit={(reason) => void reject(reason)}
      >
        A new patient record (with a new MRN) is created from the sign-up details and linked to{' '}
        {toReject?.signup.firstName}'s account. The existing record stays as it is.
      </ReasonDialog>
    </section>
  );
}
