import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Trash2 } from 'lucide-react';
import { useFieldArray, useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import Alert from '../../../components/ui/Alert';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Modal from '../../../components/ui/Modal';
import Select from '../../../components/ui/Select';
import { ALLERGY_SEVERITIES, optionsOf } from '../../../constants/catalog';
import { applyServerFieldErrorsByPath } from '../../../utils/forms';
import { getQueryErrorMessage } from '../../../utils/http';
import { useUpdateClinicalProfileMutation, type Patient } from '../../patients/api';
import { clinicalProfileSchema, type ClinicalProfileForm } from '../schemas';

const SEVERITY_OPTIONS = optionsOf(ALLERGY_SEVERITIES);

const toForm = (p: Patient): ClinicalProfileForm => ({
  allergies: (p.allergies ?? []).map((a) => ({
    id: a.id,
    substance: a.substance,
    reaction: a.reaction ?? '',
    severity: a.severity,
  })),
  chronicConditions: (p.chronicConditions ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    since: c.since ?? '',
    notes: c.notes ?? '',
  })),
});

/**
 * Allergies and chronic conditions of a patient the doctor cares for (PATCH
 * /patients/:id/clinical-profile, spec §7.7). Who recorded each entry is set by the server.
 */
export default function ClinicalProfileModal({
  patient,
  open,
  onClose,
}: {
  patient: Patient;
  open: boolean;
  onClose: () => void;
}) {
  const [update, updating] = useUpdateClinicalProfileMutation();
  const form = useForm<ClinicalProfileForm>({
    resolver: zodResolver(clinicalProfileSchema),
    values: toForm(patient),
  });
  const { register, control, handleSubmit, formState, setError } = form;
  const allergies = useFieldArray({ control, name: 'allergies' });
  const conditions = useFieldArray({ control, name: 'chronicConditions' });
  const err = formState.errors;

  const submit = handleSubmit(async (v) => {
    try {
      await update({
        id: patient.id,
        body: {
          allergies: v.allergies.map((a) => ({
            ...(a.id ? { id: a.id } : {}),
            substance: a.substance,
            reaction: a.reaction || null,
            severity: a.severity,
          })),
          chronicConditions: v.chronicConditions.map((c) => ({
            ...(c.id ? { id: c.id } : {}),
            name: c.name,
            since: c.since || null,
            notes: c.notes || null,
          })),
        },
      }).unwrap();
      toast.success('Clinical profile updated');
      onClose();
    } catch (e) {
      if (
        !applyServerFieldErrorsByPath(e, setError, (path) =>
          path.startsWith('body.') ? path.slice(5) : null,
        )
      ) {
        setError('root', { message: getQueryErrorMessage(e) });
      }
    }
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Allergies and chronic conditions"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={updating.isLoading}>
            Save
          </Button>
        </>
      }
    >
      <form onSubmit={(e) => void submit(e)} className="space-y-6" noValidate>
        {err.root?.message && <Alert tone="error">{err.root.message}</Alert>}
        <fieldset className="space-y-3">
          <legend className="text-card text-ink">Allergies</legend>
          {allergies.fields.length === 0 && (
            <p className="text-sm text-muted">No known allergies.</p>
          )}
          {allergies.fields.map((f, i) => (
            <div
              key={f.id}
              className="grid gap-3 rounded-control border border-line p-3 sm:grid-cols-[1fr_1fr_8rem_auto]"
            >
              <Input
                label="Substance"
                error={err.allergies?.[i]?.substance?.message}
                {...register(`allergies.${i}.substance`)}
              />
              <Input label="Reaction" {...register(`allergies.${i}.reaction`)} />
              <Select
                label="Severity"
                options={SEVERITY_OPTIONS}
                {...register(`allergies.${i}.severity`)}
              />
              <div className="flex items-end pb-1">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove allergy ${i + 1}`}
                  onClick={() => allergies.remove(i)}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          ))}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => allergies.append({ substance: '', reaction: '', severity: 'moderate' })}
          >
            <Plus className="h-4 w-4" aria-hidden="true" /> Add allergy
          </Button>
        </fieldset>
        <fieldset className="space-y-3">
          <legend className="text-card text-ink">Chronic conditions</legend>
          {conditions.fields.length === 0 && <p className="text-sm text-muted">None recorded.</p>}
          {conditions.fields.map((f, i) => (
            <div
              key={f.id}
              className="grid gap-3 rounded-control border border-line p-3 sm:grid-cols-[1fr_10rem_1fr_auto]"
            >
              <Input
                label="Condition"
                error={err.chronicConditions?.[i]?.name?.message}
                {...register(`chronicConditions.${i}.name`)}
              />
              <Input label="Since" type="date" {...register(`chronicConditions.${i}.since`)} />
              <Input label="Notes" {...register(`chronicConditions.${i}.notes`)} />
              <div className="flex items-end pb-1">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove condition ${i + 1}`}
                  onClick={() => conditions.remove(i)}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          ))}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => conditions.append({ name: '', since: '', notes: '' })}
          >
            <Plus className="h-4 w-4" aria-hidden="true" /> Add condition
          </Button>
        </fieldset>
      </form>
    </Modal>
  );
}
