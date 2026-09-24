import { skipToken } from '@reduxjs/toolkit/query';
import { BellRing, FileSignature, History, Printer, Stethoscope } from 'lucide-react';
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '../../../app/hooks';
import Alert from '../../../components/ui/Alert';
import Button from '../../../components/ui/Button';
import { buttonClass } from '../../../components/ui/buttonClass';
import ConfirmDialog from '../../../components/ui/ConfirmDialog';
import EmptyState from '../../../components/ui/EmptyState';
import ErrorState from '../../../components/ui/ErrorState';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import Modal from '../../../components/ui/Modal';
import PageHeader from '../../../components/ui/PageHeader';
import SectionCard from '../../../components/ui/SectionCard';
import Tabs from '../../../components/ui/Tabs';
import { useUnsavedChanges } from '../../../hooks/useUnsavedChanges';
import { getQueryErrorMessage, isApiQueryError } from '../../../utils/http';
import {
  useAppointmentActionMutation,
  useGetAppointmentQuery,
  type Appointment,
} from '../../appointments/api';
import { selectCurrentUser } from '../../auth/authSlice';
import { useGetPatientQuery, type Patient } from '../../patients/api';
import { useCurrentPrescription } from '../../prescriptions/useCurrentPrescription';
import { useCallNextMutation } from '../../queue/api';
import { useGetEncounterByAppointmentQuery, type Encounter, type SignResult } from '../api';
import AutosaveStatus from '../components/AutosaveStatus';
import ConsultHeader from '../components/ConsultHeader';
import DiagnosesEditor from '../components/DiagnosesEditor';
import FollowUpFields from '../components/FollowUpFields';
import HistoryPanel from '../components/HistoryPanel';
import NoteTextField from '../components/NoteTextField';
import PrescriptionTab from '../components/PrescriptionTab';
import SignDialog from '../components/SignDialog';
import SignedNoteView from '../components/SignedNoteView';
import VitalsFields from '../components/VitalsFields';
import { rxClosed } from '../../prescriptions/rxDraftSlice';
import { usePrescriptionDraft } from '../../prescriptions/usePrescriptionDraft';
import { combineSaves } from '../autosaveLabel';
import { applyChanges, closed, discarded, hasChanges, opened } from '../consultDraftSlice';
import { CONSULT_TABS, fieldTarget, type ConsultTab } from '../fields';
import { useAutosave } from '../useAutosave';

/** Side panel: a column from `lg`, a drawer below (spec: usable on mobile). */
function WithHistory({
  patientId,
  encounterId,
  children,
}: {
  patientId: string;
  encounterId: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="min-w-0 space-y-6">
        <div className="lg:hidden">
          <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
            <History className="h-4 w-4" aria-hidden="true" /> Patient history
          </Button>
        </div>
        {children}
      </div>
      <aside aria-label="Patient history" className="hidden lg:block">
        <div className="sticky top-40 rounded-card border border-line bg-surface p-4 shadow-card">
          <HistoryPanel patientId={patientId} currentEncounterId={encounterId} />
        </div>
      </aside>
      <Modal open={open} onClose={() => setOpen(false)} variant="drawer" title="Patient history">
        <HistoryPanel patientId={patientId} currentEncounterId={encounterId} />
      </Modal>
    </div>
  );
}

/** The editable draft: tabs, autosave, conflict handling, review & sign. */
function DraftWorkspace({
  encounter,
  appointment,
  patient,
  onReload,
  onSigned,
}: {
  encounter: Encounter;
  appointment: Appointment | undefined;
  patient: Patient;
  onReload: () => Promise<Encounter | undefined>;
  onSigned: (result: SignResult) => void;
}) {
  const dispatch = useAppDispatch();
  const id = encounter.id;
  const [tab, setTab] = useState<ConsultTab>('vitals');
  const [signOpen, setSignOpen] = useState(false);
  const [reloadAsk, setReloadAsk] = useState(false);
  const { entry, change, saveNow, dirty } = useAutosave(id);
  const current = useCurrentPrescription(id);
  const rx = usePrescriptionDraft(id, current.prescription, !current.isLoading);

  useEffect(() => {
    dispatch(opened({ id, revision: encounter.revision }));
  }, [dispatch, id, encounter.revision]);
  // Leaving the note (after the unsaved-changes prompt) forgets its local edits.
  useEffect(
    () => () => {
      dispatch(closed({ id }));
      dispatch(rxClosed({ id }));
    },
    [dispatch, id],
  );

  const leaveGuard = useUnsavedChanges(dirty || rx.dirty);
  const note = applyChanges(encounter, entry);
  const blocked = entry?.status === 'conflict' || entry?.status === 'locked';
  const rxBlocked = rx.entry?.status === 'conflict' || rx.entry?.status === 'locked';
  const save = () => void saveNow();
  const saveAll = () => {
    void saveNow();
    void rx.saveNow();
  };
  const summary = combineSaves(
    entry && { status: entry.status, savedAt: entry.savedAt, dirty: hasChanges(entry.edits) },
    rx.entry && { status: rx.entry.status, savedAt: rx.entry.savedAt, dirty: rx.dirty },
  );
  /** Rows the prescription cannot be saved with – they block signing too. */
  const rxProblems = Object.entries(rx.problems).flatMap(([i, fields]) =>
    Object.values(fields).map((message) => ({ field: `prescription.items.${i}`, message })),
  );

  const goTo = (field: string) => {
    const target = fieldTarget(field);
    setTab(target.tab);
    setTimeout(() => document.getElementById(target.elementId)?.focus(), 50);
  };

  const reload = async () => {
    setReloadAsk(false);
    const fresh = await onReload();
    if (fresh) dispatch(discarded({ id, revision: fresh.revision }));
  };

  return (
    <>
      <ConsultHeader
        patient={patient}
        appointment={appointment}
        status={<AutosaveStatus summary={summary} />}
        actions={
          <Button onClick={() => setSignOpen(true)} disabled={blocked || rxBlocked}>
            <FileSignature className="h-4 w-4" aria-hidden="true" /> Review &amp; sign
          </Button>
        }
      />
      <div className="mt-6">
        <WithHistory patientId={patient.id} encounterId={id}>
          {blocked && (
            <Alert tone="error" title="This note was changed in another tab or window">
              <p>
                Autosave has stopped so nothing is overwritten. Reload the latest version to carry
                on (your unsaved changes here are discarded).
              </p>
              <div className="mt-2">
                <Button size="sm" variant="secondary" onClick={() => setReloadAsk(true)}>
                  Reload latest
                </Button>
              </div>
            </Alert>
          )}
          {rxBlocked && (
            <Alert tone="error" title="The prescription was changed in another tab or window">
              <p>Autosave of the prescription has stopped so nothing is overwritten.</p>
              <div className="mt-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    rx.discard(current.prescription?.revision ?? null);
                    current.refetch();
                  }}
                >
                  Reload prescription
                </Button>
              </div>
            </Alert>
          )}
          {rx.entry?.status === 'error' && rx.entry.message && (
            <Alert tone="error" title="Prescription not saved">
              {rx.entry.message}
            </Alert>
          )}
          {entry?.status === 'closed' && (
            <Alert tone="error" title="Editing closed">
              {entry.message ?? 'The documentation window for this visit has closed.'}
            </Alert>
          )}
          {entry?.status === 'error' && entry.message && (
            <Alert tone="error" title="Not saved">
              {entry.message}
            </Alert>
          )}
          <SectionCard title="Consultation" icon={Stethoscope} iconTone="consult">
            <Tabs
              label="Consultation sections"
              tabs={CONSULT_TABS}
              value={tab}
              onChange={(next) => {
                saveAll();
                setTab(next as ConsultTab);
              }}
            >
              <fieldset disabled={blocked} className="space-y-4">
                <legend className="sr-only">{CONSULT_TABS.find((t) => t.id === tab)?.label}</legend>
                {tab === 'vitals' && (
                  <VitalsFields vitals={note.vitals} onChange={change} onBlur={save} />
                )}
                {tab === 'notes' && (
                  <>
                    <NoteTextField
                      field="chiefComplaint"
                      required
                      value={note.chiefComplaint}
                      onChange={change}
                      onBlur={save}
                    />
                    <NoteTextField
                      field="historyOfPresentIllness"
                      value={note.historyOfPresentIllness}
                      onChange={change}
                      onBlur={save}
                    />
                    <NoteTextField
                      field="pastHistory"
                      value={note.pastHistory}
                      onChange={change}
                      onBlur={save}
                    />
                    <NoteTextField
                      field="examination"
                      value={note.examination}
                      onChange={change}
                      onBlur={save}
                    />
                  </>
                )}
                {tab === 'diagnosis' && (
                  <>
                    <DiagnosesEditor diagnoses={note.diagnoses} onChange={change} onBlur={save} />
                    <NoteTextField
                      field="assessment"
                      value={note.assessment}
                      onChange={change}
                      onBlur={save}
                    />
                    <NoteTextField field="plan" value={note.plan} onChange={change} onBlur={save} />
                    <NoteTextField
                      field="adviceToPatient"
                      value={note.adviceToPatient}
                      onChange={change}
                      onBlur={save}
                    />
                  </>
                )}
                {tab === 'prescription' && <PrescriptionTab current={current} draft={rx} />}
                {tab === 'followup' && (
                  <FollowUpFields followUp={note.followUp} onChange={change} onBlur={save} />
                )}
              </fieldset>
            </Tabs>
          </SectionCard>
          <p className="text-xs text-muted">
            Changes save automatically (Ctrl/⌘ + S saves at once). Unsaved changes are kept only in
            this tab.
          </p>
        </WithHistory>
      </div>
      <SignDialog
        open={signOpen}
        note={note}
        prescription={current.prescription}
        flush={async () => (await saveNow()) && (await rx.saveNow())}
        extraProblems={rxProblems}
        revision={() => entry?.revision ?? encounter.revision}
        onClose={() => setSignOpen(false)}
        onGoTo={goTo}
        onSigned={(result) => {
          setSignOpen(false);
          dispatch(closed({ id }));
          dispatch(rxClosed({ id }));
          onSigned(result);
        }}
      />
      <ConfirmDialog
        open={reloadAsk}
        title="Reload the latest version?"
        confirmLabel="Reload and discard my changes"
        tone="danger"
        onConfirm={() => void reload()}
        onCancel={() => setReloadAsk(false)}
      >
        Your unsaved changes in this tab will be lost. The note will show what was last saved.
      </ConfirmDialog>
      {leaveGuard}
    </>
  );
}

/** After signing: what next (call the next patient, print the prescription). */
function SignedNext({ result }: { result: SignResult }) {
  const navigate = useNavigate();
  const [callNext, calling] = useCallNextMutation();
  const onCallNext = async () => {
    try {
      const called = await callNext().unwrap();
      if (called) navigate(`/doctor/consult/${called.id}`);
      else {
        toast('Nobody is waiting');
        navigate('/doctor/queue');
      }
    } catch (err) {
      toast.error(getQueryErrorMessage(err));
    }
  };
  return (
    <Alert tone="success" title="Note signed">
      <p>
        {result.prescription
          ? `Prescription ${result.prescription.prescriptionNumber ?? ''} issued. `
          : ''}
        The consultation is complete.
        {result.warnings.length ? ` ${result.warnings.join(' ')}` : ''}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" onClick={() => void onCallNext()} loading={calling.isLoading}>
          <BellRing className="h-4 w-4" aria-hidden="true" /> Call next patient
        </Button>
        {result.prescription && (
          <Link
            to={`/print/prescriptions/${result.prescription.id}`}
            className={buttonClass('secondary', 'sm')}
          >
            <Printer className="h-4 w-4" aria-hidden="true" /> Print prescription
          </Link>
        )}
      </div>
    </Alert>
  );
}

/** No note for this appointment yet: start the consultation (checked in) or explain. */
function NoNoteYet({
  appointment,
  onStarted,
}: {
  appointment?: Appointment;
  onStarted: () => void;
}) {
  const [start, starting] = useAppointmentActionMutation();
  const canStart = appointment?.status === 'checked_in';
  return (
    <EmptyState
      icon={Stethoscope}
      title="No clinical note for this appointment yet"
      description={
        canStart
          ? 'Start the consultation to open a note.'
          : 'Notes are created when a consultation starts.'
      }
      action={
        canStart ? (
          <Button
            loading={starting.isLoading}
            onClick={() =>
              void start({ id: appointment.id, action: 'start' })
                .unwrap()
                .then(onStarted)
                .catch((err: unknown) => toast.error(getQueryErrorMessage(err)))
            }
          >
            Start consultation
          </Button>
        ) : undefined
      }
    />
  );
}

/**
 * /doctor/consult/:appointmentId – the consult workspace (spec §4.7, §13.4 #4). A draft note
 * is edited here; a signed one is shown read-only with Amend.
 */
export default function ConsultWorkspacePage() {
  const { appointmentId = '' } = useParams();
  const user = useAppSelector(selectCurrentUser);
  const appointment = useGetAppointmentQuery(appointmentId);
  const note = useGetEncounterByAppointmentQuery(appointmentId);
  const patientId = note.data?.patient.id ?? appointment.data?.patient?.id;
  const patient = useGetPatientQuery(patientId ?? skipToken);
  const [signed, setSigned] = useState<SignResult | null>(null);

  const noNote = note.isError && isApiQueryError(note.error) && note.error.status === 404;
  const header = (
    <PageHeader
      back={{ to: '/doctor/queue', label: 'My queue' }}
      title="Consultation"
      description={appointment.data?.appointmentNumber}
    />
  );

  if (note.isLoading || appointment.isLoading || (patientId && patient.isLoading)) {
    return (
      <section>
        {header}
        <ListSkeleton label="Opening the consultation…" rows={5} />
      </section>
    );
  }
  if (noNote) {
    return (
      <section>
        {header}
        <NoNoteYet appointment={appointment.data} onStarted={() => void note.refetch()} />
      </section>
    );
  }
  const failed = note.isError ? note : appointment.isError ? appointment : patient;
  if (failed.isError || !note.data || !patient.data) {
    return (
      <section>
        {header}
        <ErrorState
          error={failed.error}
          onRetry={() => {
            void note.refetch();
            void appointment.refetch();
            if (patientId) void patient.refetch();
          }}
        />
      </section>
    );
  }

  const encounter = note.data;
  if (encounter.status === 'draft') {
    return (
      <section>
        <DraftWorkspace
          key={encounter.id}
          encounter={encounter}
          appointment={appointment.data}
          patient={patient.data}
          onReload={async () => (await note.refetch()).data}
          onSigned={setSigned}
        />
      </section>
    );
  }
  return (
    <section className="space-y-6">
      <ConsultHeader patient={patient.data} appointment={appointment.data} />
      {signed && <SignedNext result={signed} />}
      <WithHistory patientId={patient.data.id} encounterId={encounter.id}>
        <SignedNoteView encounter={encounter} canAmend={encounter.doctor.id === user?.id} />
      </WithHistory>
    </section>
  );
}
