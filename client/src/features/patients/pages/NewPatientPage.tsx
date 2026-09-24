import { zodResolver } from '@hookform/resolvers/zod';
import { useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Link, useNavigate } from 'react-router-dom';
import Alert from '../../../components/ui/Alert';
import Button from '../../../components/ui/Button';
import { buttonClass } from '../../../components/ui/buttonClass';
import PageHeader from '../../../components/ui/PageHeader';
import { useUnsavedChanges } from '../../../hooks/useUnsavedChanges';
import { applyServerFieldErrorsByPath } from '../../../utils/forms';
import { getQueryErrorMessage, isApiQueryError } from '../../../utils/http';
import { useCreatePatientMutation, type DuplicateMatch } from '../api';
import DuplicatePanel from '../components/DuplicatePanel';
import PatientFormSections from '../components/PatientFormSections';
import { useDuplicateCheck } from '../components/useDuplicateCheck';
import {
  emptyPatientForm,
  newPatientSchema,
  toPatientBody,
  type PatientFormValues,
} from '../schemas';

const BASE = '/reception/patients';

/** Server field path ('allergies.0.substance') → form path; unknown paths are skipped. */
const toFormPath = (path: string) =>
  /^(firstName|lastName|dateOfBirth|gender|bloodGroup|phone|email|address|emergencyContact|allergies|insurance|preferredLanguage|adminNotes|consent)\b/.test(
    path,
  )
    ? path
    : null;

/**
 * /reception/patients/new (spec §4.3): runs the duplicate check while typing; a possible match
 * shows the "Possible existing patient" panel. "This is a different person" asks for a reason and
 * saves with `force` (audited). After saving, opens the record and offers a portal invite.
 */
export default function NewPatientPage() {
  const navigate = useNavigate();
  const [createPatient, { isLoading: saving }] = useCreatePatientMutation();
  // The last 409 and the "different person" reason, for the details they were given for.
  const [decision, setDecision] = useState<{
    key: string;
    serverMatches: DuplicateMatch[] | null;
    overrideReason: string | null;
  }>({ key: '', serverMatches: null, overrideReason: null });
  const panelRef = useRef<HTMLDivElement>(null);

  const form = useForm<PatientFormValues>({
    resolver: zodResolver(newPatientSchema),
    defaultValues: emptyPatientForm(),
  });
  const {
    handleSubmit,
    setError,
    control,
    formState: { errors, isDirty, isSubmitSuccessful },
  } = form;
  const [firstName, lastName, dateOfBirth, phone] = useWatch({
    control,
    name: ['firstName', 'lastName', 'dateOfBirth', 'phone'],
  });
  const liveMatches = useDuplicateCheck({ firstName, lastName, dateOfBirth, phone });
  // Changed details make the last decision stale.
  const key = [firstName, lastName, dateOfBirth, phone].join('|');
  const current = decision.key === key ? decision : null;
  const overrideReason = current?.overrideReason ?? null;
  const matches = current?.serverMatches ?? liveMatches;
  const leaveGuard = useUnsavedChanges(isDirty && !saving && !isSubmitSuccessful);

  const save = (reason: string | null) =>
    handleSubmit(async (values) => {
      try {
        const patient = await createPatient({
          ...toPatientBody(values, { allergies: true, consent: true }),
          ...(reason ? { force: true, reason } : {}),
        }).unwrap();
        toast.success(`${patient.fullName} registered – ${patient.mrn}`);
        navigate(`${BASE}/${patient.id}`, { state: { offerInvite: Boolean(patient.email) } });
      } catch (err) {
        if (isApiQueryError(err) && err.code === 'DUPLICATE_PATIENT') {
          const found = (err.details as { matches?: DuplicateMatch[] } | undefined)?.matches ?? [];
          setDecision({ key, serverMatches: found, overrideReason: null });
          panelRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
          return;
        }
        if (!applyServerFieldErrorsByPath(err, setError, toFormPath)) {
          setError('root', { message: getQueryErrorMessage(err) });
        }
      }
    })();

  return (
    <section className="mx-auto w-full max-w-form">
      <PageHeader
        back={{ to: BASE, label: 'Patients' }}
        title="New patient"
        description="An MRN is issued when you save."
      />

      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save(overrideReason);
        }}
        className="space-y-6"
      >
        {errors.root && <Alert tone="error">{errors.root.message}</Alert>}
        <PatientFormSections
          form={form}
          showAllergies
          showConsent
          afterContact={
            <div ref={panelRef}>
              <DuplicatePanel
                matches={matches}
                basePath={BASE}
                overrideReason={overrideReason}
                saving={saving}
                onDifferentPerson={(reason) => {
                  setDecision({
                    key,
                    serverMatches: current?.serverMatches ?? null,
                    overrideReason: reason,
                  });
                  void save(reason);
                }}
              />
            </div>
          }
        />
        <div className="sticky bottom-0 z-10 -mx-4 flex flex-col-reverse gap-2 border-t border-line bg-surface/90 px-4 py-3 backdrop-blur-md sm:mx-0 sm:flex-row sm:justify-end sm:rounded-card sm:border sm:shadow-card-hover">
          <Link to={BASE} className={buttonClass('ghost')}>
            Cancel
          </Link>
          <Button type="submit" loading={saving}>
            Register patient
          </Button>
        </div>
      </form>
      {leaveGuard}
    </section>
  );
}
