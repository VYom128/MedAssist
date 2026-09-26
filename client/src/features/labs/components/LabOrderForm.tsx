import { useState } from 'react';
import Alert from '../../../components/ui/Alert';
import Button from '../../../components/ui/Button';
import Modal from '../../../components/ui/Modal';
import Select from '../../../components/ui/Select';
import Textarea from '../../../components/ui/Textarea';
import {
  LAB_PRIORITIES,
  LAB_PRIORITY_LABELS,
  LAB_RULES,
  optionsOf,
  type LabPriority,
} from '../../../constants/catalog';
import TestPicker, { type PickedTest } from './TestPicker';

export interface LabOrderFormValues {
  tests: PickedTest[];
  priority: LabPriority;
  clinicalNotes: string;
}

const EMPTY: LabOrderFormValues = { tests: [], priority: 'routine', clinicalNotes: '' };

/**
 * Choose tests, priority and notes for the lab (spec §7.14 POST /lab-orders). Used for new orders
 * and for editing a draft. `note` explains where the order goes (draft vs straight to the lab).
 * Mount it only while it is open (`{open && <LabOrderForm … />}`) so every opening starts from
 * `initial`.
 */
export default function LabOrderForm({
  open,
  title,
  initial = EMPTY,
  submitLabel,
  note,
  saving,
  error,
  onSubmit,
  onClose,
}: {
  open: boolean;
  title: string;
  initial?: LabOrderFormValues;
  submitLabel: string;
  note: string;
  saving: boolean;
  error?: string | null;
  onSubmit: (values: LabOrderFormValues) => void;
  onClose: () => void;
}) {
  const [values, setValues] = useState<LabOrderFormValues>(initial);
  const [missing, setMissing] = useState(false);

  const submit = () => {
    if (values.tests.length === 0) {
      setMissing(true);
      return;
    }
    onSubmit(values);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="error" title={error} />}
        <TestPicker
          value={values.tests}
          onChange={(tests) => {
            setMissing(false);
            setValues((v) => ({ ...v, tests }));
          }}
          error={missing ? 'Choose at least one test' : undefined}
        />
        <div className="grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
          <Select
            label="Priority"
            options={optionsOf(LAB_PRIORITIES, LAB_PRIORITY_LABELS)}
            value={values.priority}
            onChange={(e) => setValues((v) => ({ ...v, priority: e.target.value as LabPriority }))}
          />
          <Textarea
            label="Clinical notes for the lab (optional)"
            hint="Why the tests are needed – the lab sees this."
            maxLength={LAB_RULES.clinicalNotesMax}
            rows={2}
            value={values.clinicalNotes}
            onChange={(e) => setValues((v) => ({ ...v, clinicalNotes: e.target.value }))}
          />
        </div>
        <p className="text-sm text-muted">{note}</p>
      </div>
    </Modal>
  );
}
