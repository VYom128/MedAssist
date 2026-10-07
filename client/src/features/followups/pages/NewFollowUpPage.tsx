import { zodResolver } from '@hookform/resolvers/zod';
import { Paperclip, Send, X } from 'lucide-react';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Link, useNavigate } from 'react-router-dom';
import Alert from '../../../components/ui/Alert';
import Button from '../../../components/ui/Button';
import FileUpload from '../../../components/ui/FileUpload';
import Input from '../../../components/ui/Input';
import PageHeader from '../../../components/ui/PageHeader';
import SectionCard from '../../../components/ui/SectionCard';
import Select from '../../../components/ui/Select';
import Textarea from '../../../components/ui/Textarea';
import { linkClass } from '../../../components/ui/linkClass';
import { useAppSelector } from '../../../app/hooks';
import { clinicDate, formatDate } from '../../../utils/dates';
import { getQueryErrorMessage, isApiQueryError } from '../../../utils/http';
import { useListAppointmentsQuery } from '../../appointments/api';
import { selectCurrentUser } from '../../auth/authSlice';
import { useUploadDocument, type ClinicDocument } from '../../documents/api';
import { FOLLOWUP_TYPES, useCreateFollowupMutation } from '../api';
import EmergencyBanner from '../components/EmergencyBanner';
import { FOLLOWUP_TYPE_LABELS } from '../labels';
import { newFollowupSchema, type NewFollowupValues } from '../schemas';

const MAX_FILES = 3;

const CHOICE =
  'flex w-full flex-col items-start gap-0.5 rounded-card border p-4 text-left transition-colors duration-150 ease-standard focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary-600';

/**
 * /patient/follow-ups/new – the patient's request (spec §4.10): what it is about (plain words),
 * the visit it relates to (optional – its doctor gets it), the message, a preferred date and up to
 * three files (uploaded to their documents first). The emergency notice is always visible; the
 * request limits (FOLLOWUP_LIMIT_REACHED) are explained.
 */
export default function NewFollowUpPage() {
  const navigate = useNavigate();
  const user = useAppSelector(selectCurrentUser);
  const visits = useListAppointmentsQuery({ status: 'completed', limit: 20, sort: '-startAt' });
  const [create, creating] = useCreateFollowupMutation();
  const { uploadDocument, progress } = useUploadDocument();
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [attached, setAttached] = useState<ClinicDocument[]>([]);
  const [problem, setProblem] = useState<{ limit: boolean; message: string } | null>(null);
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<NewFollowupValues>({
    resolver: zodResolver(newFollowupSchema),
    defaultValues: { relatedAppointmentId: '', message: '', preferredDate: '' },
  });
  const type = useWatch({ control, name: 'type' });

  const attach = async () => {
    if (!file || !user?.patientId) return;
    setFileError(null);
    try {
      const doc = await uploadDocument({
        file,
        patientId: user.patientId,
        category: 'other',
        title: file.name.slice(0, 120),
      });
      setAttached((prev) => [...prev, doc]);
      setFile(null);
    } catch (err) {
      setFileError(getQueryErrorMessage(err));
    }
  };

  const onSubmit = handleSubmit(async (values) => {
    setProblem(null);
    try {
      const created = await create({
        type: values.type,
        message: values.message.trim(),
        ...(values.relatedAppointmentId
          ? { relatedAppointmentId: values.relatedAppointmentId }
          : {}),
        ...(values.preferredDate ? { preferredDate: values.preferredDate } : {}),
        ...(attached.length ? { attachmentIds: attached.map((d) => d.id) } : {}),
      }).unwrap();
      toast.success(`Request ${created.requestNumber} sent`);
      navigate(`/patient/follow-ups/${created.id}`);
    } catch (err) {
      const limit = isApiQueryError(err) && err.code === 'FOLLOWUP_LIMIT_REACHED';
      setProblem({ limit, message: getQueryErrorMessage(err) });
    }
  });

  return (
    <section className="mx-auto w-full max-w-form space-y-6">
      <PageHeader
        back={{ to: '/patient/follow-ups', label: 'Follow-ups' }}
        title="New follow-up request"
        description="The clinic usually replies within one working day."
      />
      <EmergencyBanner />
      <form onSubmit={(e) => void onSubmit(e)} noValidate>
        <SectionCard
          title="Your request"
          footer={
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Link to="/patient/follow-ups" className={`self-center text-sm ${linkClass}`}>
                Cancel
              </Link>
              <Button type="submit" loading={creating.isLoading}>
                <Send className="h-4 w-4" aria-hidden="true" /> Send request
              </Button>
            </div>
          }
        >
          <div className="space-y-6">
            {problem && (
              <Alert
                tone={problem.limit ? 'warning' : 'error'}
                title={problem.limit ? 'You have reached the limit for now' : 'Not sent'}
              >
                <p>{problem.message}</p>
                {problem.limit && (
                  <Link to="/patient/follow-ups" className={`mt-1 inline-block ${linkClass}`}>
                    See my open requests
                  </Link>
                )}
              </Alert>
            )}

            <fieldset>
              <legend className="text-sm font-medium text-ink">What is this about?</legend>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                {FOLLOWUP_TYPES.map((t) => (
                  <label
                    key={t}
                    className={`${CHOICE} ${type === t ? 'border-primary-600 bg-primary-50' : 'border-line bg-surface hover:border-primary-500'}`}
                  >
                    <span className="flex items-center gap-2">
                      <input
                        type="radio"
                        value={t}
                        {...register('type')}
                        className="h-4 w-4 accent-primary-600"
                      />
                      <span className="font-semibold text-ink">
                        {FOLLOWUP_TYPE_LABELS[t].label}
                      </span>
                    </span>
                    <span className="pl-6 text-sm text-muted">{FOLLOWUP_TYPE_LABELS[t].hint}</span>
                  </label>
                ))}
              </div>
              {errors.type && (
                <p role="alert" className="mt-1 text-sm text-danger-700">
                  {errors.type.message}
                </p>
              )}
            </fieldset>

            <Select
              label="Related visit (optional)"
              hint="The doctor you saw gets your request."
              placeholder="Not about a particular visit"
              options={(visits.data?.items ?? []).map((a) => ({
                value: a.id,
                label: `${formatDate(a.startAt)} · Dr ${a.doctor.name}`,
              }))}
              {...register('relatedAppointmentId')}
            />

            <Textarea
              label="Your message"
              autoGrow
              maxLength={2000}
              hint="Describe what you need. Don't include passwords or bank details."
              error={errors.message?.message}
              {...register('message')}
            />

            <Input
              label="Preferred date (optional)"
              type="date"
              min={clinicDate()}
              error={errors.preferredDate?.message}
              {...register('preferredDate')}
            />

            <div className="space-y-3">
              <p className="text-sm font-medium text-ink">Attachments (optional)</p>
              {attached.length > 0 && (
                <ul className="space-y-2">
                  {attached.map((d) => (
                    <li
                      key={d.id}
                      className="flex items-center justify-between gap-2 rounded-control border border-line px-3 py-2 text-sm"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <Paperclip className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
                        <span className="truncate">{d.title}</span>
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Remove ${d.title}`}
                        onClick={() => setAttached((prev) => prev.filter((x) => x.id !== d.id))}
                      >
                        <X className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              {attached.length < MAX_FILES && (
                <>
                  <FileUpload
                    label="Add a photo or a PDF"
                    file={file}
                    onChange={setFile}
                    progress={progress}
                    error={fileError}
                  />
                  {file && (
                    <Button variant="secondary" size="sm" onClick={() => void attach()}>
                      <Paperclip className="h-4 w-4" aria-hidden="true" /> Attach
                    </Button>
                  )}
                </>
              )}
              <p className="text-xs text-muted">
                Files are also saved in your Documents. Up to {MAX_FILES} files.
              </p>
            </div>
          </div>
        </SectionCard>
      </form>
    </section>
  );
}
