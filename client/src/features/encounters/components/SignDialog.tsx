import { FileSignature } from 'lucide-react';
import { useState } from 'react';
import Alert from '../../../components/ui/Alert';
import Button from '../../../components/ui/Button';
import DescriptionList from '../../../components/ui/DescriptionList';
import Modal from '../../../components/ui/Modal';
import { getQueryErrorMessage, isApiQueryError } from '../../../utils/http';
import type { Prescription } from '../../prescriptions/api';
import { itemLine } from '../../prescriptions/format';
import { useSignEncounterMutation, type Encounter, type SignResult } from '../api';
import { fieldTarget, formatDiagnosis, formatFollowUp, signCheck, type Problem } from '../fields';

/** A list of problems, each a link to the tab and field it is about. */
function ProblemList({
  problems,
  onGoTo,
}: {
  problems: Problem[];
  onGoTo: (field: string) => void;
}) {
  return (
    <ul className="mt-1 list-disc space-y-1 pl-5">
      {problems.map((p, i) => {
        const target = fieldTarget(p.field);
        return (
          <li key={`${p.field}-${i}`}>
            <button
              type="button"
              onClick={() => onGoTo(p.field)}
              className="text-left font-semibold underline underline-offset-2 hover:no-underline focus-visible:outline-2 focus-visible:outline-primary-600"
            >
              {target.label}
            </button>
            : {p.message}
          </li>
        );
      })}
    </ul>
  );
}

/** Problems from the server's 422 details (SIGN_VALIDATION_FAILED / ALLERGY_ACK_REQUIRED). */
function problemsFrom(err: unknown): Problem[] | null {
  if (!isApiQueryError(err) || !Array.isArray(err.details)) return null;
  return (err.details as { field?: string; message?: string }[])
    .filter((d) => typeof d.field === 'string')
    .map((d) => ({ field: d.field!, message: d.message ?? 'Needs attention' }));
}

/**
 * "Review & sign" (spec §4.7 step 5, §13.3): a compact summary, warnings (no vitals) and the
 * client check's blocking problems; the server's 422 details as links to the right tab/field.
 * Pending autosave is flushed first (`flush`), then the note is signed with the latest revision.
 */
export default function SignDialog({
  open,
  note,
  prescription,
  flush,
  revision,
  onClose,
  onGoTo,
  onSigned,
}: {
  open: boolean;
  note: Encounter;
  prescription: Prescription | null;
  /** Saves pending edits; false when that failed. */
  flush: () => Promise<boolean>;
  revision: () => number;
  onClose: () => void;
  onGoTo: (field: string) => void;
  onSigned: (result: SignResult) => void;
}) {
  const [sign, signing] = useSignEncounterMutation();
  const [serverProblems, setServerProblems] = useState<Problem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { problems, warnings } = signCheck(note, prescription);
  const drugs = prescription?.status === 'draft' ? prescription.items : [];

  const close = () => {
    setServerProblems(null);
    setError(null);
    onClose();
  };
  const goTo = (field: string) => {
    close();
    onGoTo(field);
  };

  const submit = async () => {
    setServerProblems(null);
    setError(null);
    if (!(await flush())) {
      setError('Your latest changes could not be saved. Resolve the save problem, then sign.');
      return;
    }
    try {
      const result = await sign({ id: note.id, expectedVersion: revision() }).unwrap();
      setServerProblems(null);
      onSigned(result);
    } catch (err) {
      const details = problemsFrom(err);
      if (details?.length) setServerProblems(details);
      setError(getQueryErrorMessage(err));
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      size="lg"
      title="Review and sign"
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Keep editing
          </Button>
          <Button
            onClick={() => void submit()}
            loading={signing.isLoading}
            disabled={problems.length > 0}
          >
            <FileSignature className="h-4 w-4" aria-hidden="true" /> Sign note
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <Alert tone="error" title={error}>
            {serverProblems && <ProblemList problems={serverProblems} onGoTo={goTo} />}
          </Alert>
        )}
        {problems.length > 0 && (
          <Alert tone="error" title="Needed before signing">
            <ProblemList problems={problems} onGoTo={goTo} />
          </Alert>
        )}
        {warnings.length > 0 && (
          <Alert tone="warning" title="Please check">
            <ul className="list-disc pl-5">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </Alert>
        )}
        <DescriptionList
          columns={1}
          items={[
            { label: 'Chief complaint', value: note.chiefComplaint ?? '—' },
            {
              label: 'Diagnoses',
              value: note.diagnoses.length
                ? note.diagnoses.map((d) => formatDiagnosis(d)).join('; ')
                : '—',
            },
            {
              label: 'Prescription',
              value: drugs.length ? (
                <ul className="space-y-0.5">
                  {drugs.map((d, i) => (
                    <li key={i}>
                      {d.drugName}
                      {d.strength ? ` ${d.strength}` : ''} – {itemLine(d) || 'incomplete'}
                    </li>
                  ))}
                </ul>
              ) : (
                'No drugs'
              ),
            },
            { label: 'Follow-up', value: formatFollowUp(note.followUp) },
          ]}
        />
        <p className="text-sm text-muted">
          Signing locks the note: later corrections need an amendment with a reason.
          {drugs.length > 0 ? ' The prescription is issued to the patient.' : ''} The consultation
          is marked as completed.
        </p>
      </div>
    </Modal>
  );
}
