import PageHeader from '../../../components/ui/PageHeader';
import AppointmentList from '../components/AppointmentList';

/** /admin/appointments: every appointment, read-only (admins view; reception acts). */
export default function AdminAppointmentsPage() {
  return (
    <section>
      <PageHeader title="Appointments" description="All appointments (read-only)." />
      <AppointmentList base="/admin/appointments" />
    </section>
  );
}
