import { useAppSelector } from '../../../app/hooks';
import Alert from '../../../components/ui/Alert';
import PageHeader from '../../../components/ui/PageHeader';
import { selectCurrentUser } from '../../auth/authSlice';
import DocumentsPanel from '../components/DocumentsPanel';

/**
 * /patient/documents – the patient's own documents the clinic shares with them (lab reports,
 * their uploads), with preview and download, and uploads of referrals and other papers.
 */
export default function MyDocumentsPage() {
  const user = useAppSelector(selectCurrentUser);
  return (
    <section className="space-y-6">
      <PageHeader
        title="Documents"
        description="Your reports and the papers you share with the clinic, such as referral letters."
      />
      {user?.patientId ? (
        <DocumentsPanel patientId={user.patientId} title="My documents" />
      ) : (
        <Alert tone="info" title="Not available yet">
          Your documents appear here once the clinic has confirmed your identity.
        </Alert>
      )}
    </section>
  );
}
