import DashboardPlaceholder from '../components/DashboardPlaceholder';

export default function AdminDashboard() {
  return (
    <DashboardPlaceholder
      upcoming={[
        "Today's appointments by status",
        'Revenue and reports',
        'Doctor utilisation and no-show rate',
        'AI usage and audit alerts',
      ]}
    />
  );
}
