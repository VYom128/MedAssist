import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import Alert from '../../../components/ui/Alert';
import Button from '../../../components/ui/Button';
import Modal from '../../../components/ui/Modal';
import Select from '../../../components/ui/Select';
import { formatDateTime } from '../../../utils/dates';
import { isApiQueryError } from '../../../utils/http';
import { formatINR } from '../../../utils/money';
import { useGetSlotsQuery } from '../../appointments/api';
import DateAvailabilityPicker from '../../appointments/components/DateAvailabilityPicker';
import SlotPicker from '../../appointments/components/SlotPicker';
import DoctorPicker from '../../doctors/components/DoctorPicker';
import { useGetDoctorQuery } from '../../doctors/api';
import { useListServicesQuery } from '../../services/api';
import { useScheduleFollowupMutation, type Followup } from '../api';

/**
 * Books a follow-up appointment for a request (spec §4.10): doctor (reception may choose; a
 * doctor books with themselves), service, date and time from the normal slot pickers. The server
 * books through the booking service – a refusal (slot taken, patient double-booked…) is shown
 * here and the request stays as it was.
 */
export default function ScheduleFollowupModal({
  request,
  open,
  onClose,
  canChooseDoctor,
}: {
  request: Followup;
  open: boolean;
  onClose: () => void;
  canChooseDoctor: boolean;
}) {
  const assigned = request.assignedDoctor?.id ?? '';
  const [departmentId, setDepartmentId] = useState('');
  const [doctorId, setDoctorId] = useState(assigned);
  const [serviceId, setServiceId] = useState('');
  const [date, setDate] = useState('');
  const [startAt, setStartAt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [schedule, scheduling] = useScheduleFollowupMutation();

  const doctor = useGetDoctorQuery(doctorId, { skip: !doctorId });
  const dept = doctor.data?.department?.id;
  const services = useListServicesQuery({ limit: 100, ...(dept ? { department: dept } : {}) });
  const options = useMemo(
    () =>
      (services.data?.items ?? [])
        .filter((s) => s.type === 'consultation' || s.code.startsWith('FUP-'))
        .sort((a, b) => Number(b.code.startsWith('FUP-')) - Number(a.code.startsWith('FUP-'))),
    [services.data],
  );
  const chosenService = serviceId || options[0]?.id || '';
  const slots = useGetSlotsQuery(
    { doctorId, date, serviceId: chosenService },
    { skip: !doctorId || !date || !chosenService },
  );

  const close = () => {
    setDate('');
    setStartAt('');
    setError(null);
    onClose();
  };
  const submit = async () => {
    setError(null);
    if (!doctorId || !chosenService || !startAt) {
      setError('Choose a doctor, a date and a time.');
      return;
    }
    try {
      const res = await schedule({
        id: request.id,
        startAt,
        serviceId: chosenService,
        ...(doctorId !== assigned ? { doctorId } : {}),
      }).unwrap();
      toast.success(`Booked for ${formatDateTime(res.appointment.startAt)}`);
      close();
    } catch (err) {
      const code = isApiQueryError(err) ? err.code : '';
      if (code === 'SLOT_UNAVAILABLE') {
        setStartAt('');
        void slots.refetch();
        setError('That time was just taken. Please pick another time.');
      } else {
        setError(isApiQueryError(err) ? err.message : 'Something went wrong');
      }
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      size="lg"
      title={`Book a follow-up for ${request.requestNumber}`}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={scheduling.isLoading} disabled={!startAt}>
            Book appointment
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {error && (
          <Alert tone="error" title="Not booked">
            {error}
          </Alert>
        )}
        {canChooseDoctor ? (
          <DoctorPicker
            departmentId={departmentId}
            doctorId={doctorId}
            onDepartmentChange={setDepartmentId}
            onDoctorChange={(id) => {
              setDoctorId(id);
              setServiceId('');
              setDate('');
              setStartAt('');
            }}
          />
        ) : (
          <p className="text-sm text-muted">
            With you{doctor.data ? ` (${doctor.data.name})` : ''}.
          </p>
        )}
        {doctorId && (
          <Select
            label="Service"
            options={options.map((s) => ({
              value: s.id,
              label: `${s.name} · ${formatINR(s.pricePaise)}`,
            }))}
            value={chosenService}
            onChange={(e) => {
              setServiceId(e.target.value);
              setStartAt('');
            }}
          />
        )}
        {doctorId && chosenService && (
          <DateAvailabilityPicker
            doctorId={doctorId}
            serviceId={chosenService}
            value={date}
            onChange={(d) => {
              setDate(d);
              setStartAt('');
            }}
          />
        )}
        {date && (
          <SlotPicker
            slots={slots.data?.slots}
            loading={slots.isFetching && !slots.data}
            value={startAt}
            onChange={setStartAt}
          />
        )}
      </div>
    </Modal>
  );
}
