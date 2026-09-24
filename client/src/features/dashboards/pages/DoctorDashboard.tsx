import DashboardPlaceholder from '../components/DashboardPlaceholder';

export default function DoctorDashboard() {
  return (
    <DashboardPlaceholder
      upcoming={['Consultations, notes and prescriptions', 'Lab results to review', 'Follow-ups']}
    />
  );
}
