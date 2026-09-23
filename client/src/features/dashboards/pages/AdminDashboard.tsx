import DashboardPlaceholder from '../components/DashboardPlaceholder';

export default function AdminDashboard() {
  return (
    <DashboardPlaceholder
      upcoming={[
        'Clinic settings, departments and services',
        'Doctor schedules and lab test catalogue',
        'Users and audit logs',
        'Reports and revenue',
      ]}
    />
  );
}
