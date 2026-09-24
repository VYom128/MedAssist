import { Building2, CalendarCheck, Stethoscope } from 'lucide-react';
import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Link, useNavigate } from 'react-router-dom';
import { useAppSelector } from '../../../app/hooks';
import Alert from '../../../components/ui/Alert';
import Button from '../../../components/ui/Button';
import DescriptionList from '../../../components/ui/DescriptionList';
import EmptyState from '../../../components/ui/EmptyState';
import ErrorState from '../../../components/ui/ErrorState';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import PageHeader from '../../../components/ui/PageHeader';
import SectionCard from '../../../components/ui/SectionCard';
import Textarea from '../../../components/ui/Textarea';
import { linkClass } from '../../../components/ui/linkClass';
import { VERIFY_IDENTITY_PATH } from '../../../routes/home';
import { formatDateTime } from '../../../utils/dates';
import { isApiQueryError } from '../../../utils/http';
import { formatINR } from '../../../utils/money';
import { formatPhone } from '../../../utils/phone';
import { selectCurrentUser } from '../../auth/authSlice';
import { useListDepartmentsQuery } from '../../departments/api';
import { useListDoctorsQuery, type Doctor } from '../../doctors/api';
import { useListServicesQuery } from '../../services/api';
import { useGetPublicSettingsQuery } from '../../settings/api';
import { useBookAppointmentMutation, useGetSlotsQuery } from '../api';
import DateAvailabilityPicker from '../components/DateAvailabilityPicker';
import SlotPicker from '../components/SlotPicker';

const STEPS = ['Department', 'Doctor', 'Date', 'Time', 'Reason', 'Confirm'] as const;
type Step = 0 | 1 | 2 | 3 | 4 | 5;

const CHOICE =
  'flex w-full flex-col items-start gap-1 rounded-card border p-4 text-left transition-colors duration-150 ease-standard focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600';
const choiceClass = (selected: boolean) =>
  `${CHOICE} ${selected ? 'border-primary-600 bg-primary-50' : 'border-line bg-surface hover:border-primary-500'}`;

/**
 * /patient/appointments/book (spec §13.4 #2): department → doctor → date (free times per day) →
 * time → reason → confirm. Server refusals get a plain explanation; a time taken meanwhile sends
 * the patient back to pick another (the free times refresh).
 */
export default function BookAppointmentPage() {
  const user = useAppSelector(selectCurrentUser);
  const navigate = useNavigate();
  const { data: clinic } = useGetPublicSettingsQuery();
  const [step, setStep] = useState<Step>(0);
  const [departmentId, setDepartmentId] = useState('');
  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [date, setDate] = useState('');
  const [startAt, setStartAt] = useState('');
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<{ step: Step; message: string; code?: string } | null>(
    null,
  );
  const [book, { isLoading: booking }] = useBookAppointmentMutation();

  const departments = useListDepartmentsQuery({ limit: 100 });
  const doctors = useListDoctorsQuery(
    { department: departmentId, accepting: true, limit: 100 },
    { skip: !departmentId },
  );
  const services = useListServicesQuery({ limit: 100 });
  // The department's consultation (the service patients book online).
  const service = useMemo(() => {
    const items = services.data?.items ?? [];
    const dept = doctor?.department?.id;
    return (
      items.find((s) => s.type === 'consultation' && s.department?.id === dept) ??
      items.find((s) => s.type === 'consultation' && !s.department) ??
      null
    );
  }, [services.data, doctor]);
  const slots = useGetSlotsQuery(
    { doctorId: doctor?.id ?? '', date, serviceId: service?.id },
    { skip: !doctor || !date || !service },
  );

  const phone = clinic?.phone ? ` on ${formatPhone(clinic.phone)}` : '';
  if (user?.patientLinkStatus === 'pending_verification') {
    return (
      <section>
        <PageHeader
          title="Book an appointment"
          back={{ to: '/patient/appointments', label: 'My appointments' }}
        />
        <Alert tone="warning" title="Please verify your identity first">
          You can book online once reception has checked your photo ID.{' '}
          <Link to={VERIFY_IDENTITY_PATH} className={linkClass}>
            What to bring
          </Link>
        </Alert>
      </section>
    );
  }
  if (clinic && !clinic.appointment.allowPatientSelfBooking) {
    return (
      <section>
        <PageHeader
          title="Book an appointment"
          back={{ to: '/patient/appointments', label: 'My appointments' }}
        />
        <Alert tone="info" title="Online booking is turned off">
          Please call the clinic{phone} to book an appointment.
        </Alert>
      </section>
    );
  }

  const go = (next: Step) => {
    setProblem(null);
    setStep(next);
  };
  const canContinue = [
    Boolean(departmentId),
    Boolean(doctor),
    Boolean(date),
    Boolean(startAt),
    reason.length <= 500,
    true,
  ][step];

  const confirm = async () => {
    if (!doctor || !service) return;
    try {
      const created = await book({
        doctorId: doctor.id,
        serviceId: service.id,
        startAt,
        type: 'new',
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      }).unwrap();
      toast.success(`Booked for ${formatDateTime(created.startAt)} (${created.appointmentNumber})`);
      navigate('/patient/appointments');
    } catch (err) {
      const code = isApiQueryError(err) ? err.code : '';
      const message = isApiQueryError(err) ? err.message : 'Something went wrong';
      switch (code) {
        case 'SLOT_UNAVAILABLE':
          setStartAt('');
          setStep(3);
          setProblem({
            step: 3,
            code,
            message: 'That time was just taken. Please pick another time.',
          });
          break;
        case 'OUTSIDE_BOOKING_WINDOW':
          setStartAt('');
          setStep(2);
          setProblem({ step: 2, code, message });
          break;
        case 'SELF_BOOKING_DISABLED':
          setProblem({
            step,
            code,
            message: `Online booking is turned off. Please call the clinic${phone}.`,
          });
          break;
        case 'PATIENT_LINK_PENDING':
          setProblem({
            step,
            code,
            message: 'Please verify your identity at the clinic before booking online.',
          });
          break;
        default:
          // BOOKING_LIMIT_REACHED, PATIENT_DOUBLE_BOOKED, DOCTOR_UNAVAILABLE…: the server says why.
          setProblem({ step, code, message });
      }
    }
  };

  return (
    <section className="space-y-6">
      <PageHeader
        title="Book an appointment"
        back={{ to: '/patient/appointments', label: 'My appointments' }}
      />
      <ol className="flex flex-wrap gap-2 text-sm" aria-label="Steps">
        {STEPS.map((label, i) => (
          <li
            key={label}
            aria-current={i === step ? 'step' : undefined}
            className={`rounded-full px-3 py-1 font-medium ${
              i === step
                ? 'bg-primary-600 text-white'
                : i < step
                  ? 'bg-primary-50 text-primary-700'
                  : 'bg-neutral-50 text-muted'
            }`}
          >
            {i + 1}. {label}
          </li>
        ))}
      </ol>

      <SectionCard
        title={`Step ${step + 1} of ${STEPS.length}: ${STEPS[step]}`}
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <Button
              variant="secondary"
              disabled={step === 0}
              onClick={() => go((step - 1) as Step)}
            >
              Back
            </Button>
            {step < 5 ? (
              <Button disabled={!canContinue} onClick={() => go((step + 1) as Step)}>
                Continue
              </Button>
            ) : (
              <Button loading={booking} onClick={() => void confirm()}>
                Confirm booking
              </Button>
            )}
          </div>
        }
      >
        {problem && problem.step === step && (
          <div className="mb-4">
            <Alert tone="error" title="We couldn't book this">
              {problem.message}
              {problem.code === 'BOOKING_LIMIT_REACHED' && (
                <>
                  {' '}
                  <Link to="/patient/appointments" className={linkClass}>
                    See my appointments
                  </Link>
                </>
              )}
            </Alert>
          </div>
        )}

        {step === 0 && (
          <>
            {departments.isLoading && <ListSkeleton label="Loading departments…" rows={3} />}
            {departments.isError && (
              <ErrorState error={departments.error} onRetry={() => void departments.refetch()} />
            )}
            <div
              role="radiogroup"
              aria-label="Department"
              className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
            >
              {departments.data?.items.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  role="radio"
                  aria-checked={d.id === departmentId}
                  className={choiceClass(d.id === departmentId)}
                  onClick={() => {
                    setDepartmentId(d.id);
                    setDoctor(null);
                    setDate('');
                    setStartAt('');
                  }}
                >
                  <Building2 className="h-5 w-5 text-primary-600" aria-hidden="true" />
                  <span className="font-semibold text-ink">{d.name}</span>
                  {d.description && <span className="text-sm text-muted">{d.description}</span>}
                </button>
              ))}
            </div>
          </>
        )}

        {step === 1 && (
          <>
            {doctors.isLoading && <ListSkeleton label="Loading doctors…" rows={3} />}
            {doctors.isError && (
              <ErrorState error={doctors.error} onRetry={() => void doctors.refetch()} />
            )}
            {doctors.data && doctors.data.items.length === 0 && (
              <EmptyState
                icon={Stethoscope}
                title="No doctors take online bookings here"
                description={`Please call the clinic${phone}.`}
              />
            )}
            <div role="radiogroup" aria-label="Doctor" className="grid gap-3 sm:grid-cols-2">
              {doctors.data?.items.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  role="radio"
                  aria-checked={d.id === doctor?.id}
                  className={choiceClass(d.id === doctor?.id)}
                  onClick={() => {
                    setDoctor(d);
                    setDate('');
                    setStartAt('');
                  }}
                >
                  <span className="font-semibold text-ink">{d.name}</span>
                  <span className="text-sm text-body">{d.specialization}</span>
                  <span className="text-sm text-muted">
                    Fee {formatINR(d.consultationFeePaise)}
                    {d.languages.length > 0 && ` · Speaks ${d.languages.join(', ')}`}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}

        {step === 2 && doctor && service && (
          <DateAvailabilityPicker
            doctorId={doctor.id}
            serviceId={service.id}
            value={date}
            onChange={(d) => {
              setDate(d);
              setStartAt('');
            }}
          />
        )}
        {step === 2 && doctor && services.data && !service && (
          <Alert tone="info">
            This doctor cannot be booked online. Please call the clinic{phone}.
          </Alert>
        )}

        {step === 3 && (
          <SlotPicker
            slots={slots.data?.slots}
            loading={slots.isFetching && !slots.data}
            value={startAt}
            onChange={setStartAt}
          />
        )}

        {step === 4 && (
          <Textarea
            label="Reason for visit (optional)"
            hint="In a few words, e.g. “Fever for 3 days”. Don't include personal details."
            value={reason}
            error={reason.length > 500 ? 'At most 500 characters' : undefined}
            onChange={(e) => setReason(e.target.value)}
          />
        )}

        {step === 5 && doctor && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-muted">
              <CalendarCheck className="h-4 w-4 text-primary-600" aria-hidden="true" /> Please check
              the details.
            </div>
            <DescriptionList
              items={[
                { label: 'Doctor', value: `${doctor.name} (${doctor.specialization})` },
                { label: 'Department', value: doctor.department?.name },
                { label: 'When', value: startAt ? formatDateTime(startAt) : null },
                {
                  label: 'Visit',
                  value: service ? `${service.name} · ${formatINR(service.pricePaise)}` : null,
                },
                { label: 'Reason', value: reason.trim() || null, wide: true },
              ]}
            />
            <p className="text-sm text-muted">
              You can change or cancel online up to {clinic?.appointment.minCancelHours ?? 2} hours
              before the appointment.
            </p>
          </div>
        )}
      </SectionCard>
    </section>
  );
}
