import DashboardPlaceholder from '../components/DashboardPlaceholder';

export default function PatientDashboard() {
  return (
    <DashboardPlaceholder
      upcoming={[
        'Book and manage appointments',
        'Prescriptions and lab reports',
        'Invoices',
        'Follow-up requests',
      ]}
    />
  );
}
