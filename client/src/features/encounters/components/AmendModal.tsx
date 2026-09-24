import { useState } from 'react';
import toast from 'react-hot-toast';
import Alert from '../../../components/ui/Alert';
import Button from '../../../components/ui/Button';
import Modal from '../../../components/ui/Modal';
import Textarea from '../../../components/ui/Textarea';
import {
  AMENDMENT_REASON_MIN,
  NOTE_FIELD_LABELS,
  type NoteField,
} from '../../../constants/catalog';
import { getQueryErrorMessage } from '../../../utils/http';
import { useAmendEncounterMutation, type Encounter, type NoteChanges } from '../api';
import { mergeChanges } from '../consultDraftSlice';
import { diagnosisProblems, followUpProblem, toBody } from '../fields';
import DiagnosesEditor from './DiagnosesEditor';
import FollowUpFields from './FollowUpFields';
import NoteTextField, { type TextNoteField } from './NoteTextField';
import VitalsFields from './VitalsFields';

const FIELDS = Object.keys(NOTE_FIELD_LABELS) as NoteField[];

/**
 * Amend a signed note (spec §5.2, §8.5): choose the fields to change, edit them, give a reason
 * (≥ 10 characters). Creates a new version; the before/after of each field is kept. The
 * prescription is not amended here (it is cancelled or reissued instead).
 */
export default function AmendModal({
  encounter,
  open,
  onClose,
}: {
  encounter: Encounter;
  open: boolean;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<NoteField[]>([]);
  const [changes, setChanges] = useState<NoteChanges>({});
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const [amend, amending] = useAmendEncounterMutation();

  const view: Encounter = {
    ...encounter,
    ...(changes as Partial<Encounter>),
    vitals: { ...encounter.vitals, ...changes.vitals },
  };
  const change = (c: NoteChanges) => setChanges((prev) => mergeChanges(prev, c));
  const toggle = (f: NoteField) =>
    setSelected((prev) => (prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]));

  const reasonOk = reason.trim().length >= AMENDMENT_REASON_MIN;
  const fieldProblems = [
    ...(selected.includes('diagnoses') && Object.keys(diagnosisProblems(view.diagnoses)).length
      ? ['Complete or remove the empty diagnosis rows']
      : []),
    ...(selected.includes('followUp') && followUpProblem(view.followUp)
      ? [followUpProblem(view.followUp)!]
      : []),
  ];

  const reset = () => {
    setSelected([]);
    setChanges({});
    setReason('');
    setError(null);
    setTried(false);
  };
  const close = () => {
    reset();
    onClose();
  };

  const submit = async () => {
    setTried(true);
    setError(null);
    if (selected.length === 0 || !reasonOk || fieldProblems.length > 0) return;
    const chosen: NoteChanges = {};
    for (const f of selected) {
      const value = f === 'vitals' ? changes.vitals : changes[f];
      if (value !== undefined) Object.assign(chosen, { [f]: value });
    }
    if (Object.keys(chosen).length === 0) {
      setError('Change at least one of the chosen fields.');
      return;
    }
    try {
      await amend({ id: encounter.id, reason: reason.trim(), changes: toBody(chosen) }).unwrap();
      toast.success('Amendment saved – a new version of the note was created');
      close();
    } catch (err) {
      setError(getQueryErrorMessage(err));
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      size="lg"
      title="Amend signed note"
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={amending.isLoading}>
            Save amendment
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {error && <Alert tone="error">{error}</Alert>}
        <fieldset>
          <legend className="text-card text-ink">Fields to change</legend>
          <div className="mt-2 grid gap-1 sm:grid-cols-2">
            {FIELDS.map((f) => (
              <label key={f} className="inline-flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selected.includes(f)}
                  onChange={() => toggle(f)}
                  className="h-4 w-4 accent-primary-600"
                />
                {NOTE_FIELD_LABELS[f]}
              </label>
            ))}
          </div>
          {tried && selected.length === 0 && (
            <p className="mt-1 text-sm text-danger-700">Choose at least one field.</p>
          )}
        </fieldset>

        {FIELDS.filter((f) => selected.includes(f)).map((f) => (
          <div key={f} className="rounded-control border border-line p-3">
            {f === 'vitals' ? (
              <VitalsFields vitals={view.vitals} onChange={change} />
            ) : f === 'diagnoses' ? (
              <DiagnosesEditor diagnoses={view.diagnoses} onChange={change} />
            ) : f === 'followUp' ? (
              <FollowUpFields followUp={view.followUp} onChange={change} />
            ) : (
              <NoteTextField
                field={f as TextNoteField}
                value={view[f as TextNoteField]}
                onChange={change}
              />
            )}
          </div>
        ))}
        {tried && fieldProblems.length > 0 && (
          <Alert tone="error">
            {fieldProblems.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </Alert>
        )}

        <Textarea
          label="Reason for the amendment"
          autoGrow
          required
          maxLength={1000}
          value={reason}
          error={tried && !reasonOk ? `At least ${AMENDMENT_REASON_MIN} characters` : undefined}
          hint="Kept with the note's history, visible to doctors who read it."
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
    </Modal>
  );
}
