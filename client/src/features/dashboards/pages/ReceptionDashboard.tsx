import DashboardPlaceholder from '../components/DashboardPlaceholder';

export default function ReceptionDashboard() {
  return (
    <DashboardPlaceholder
      upcoming={['Appointments and check-in', 'Queue', 'Invoices and payments']}
    />
  );
}
