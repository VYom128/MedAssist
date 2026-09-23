import { IdCard } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAppSelector } from '../../../app/hooks';
import Card from '../../../components/ui/Card';
import { ROLE_HOME } from '../../../constants/roles';
import { formatPhone } from '../../../utils/phone';
import { selectCurrentUser } from '../../auth/authSlice';
import { useGetPublicSettingsQuery } from '../../settings/api';

/**
 * Shown after a self-signup matched an existing record (spec §4.4): the patient stays logged in
 * but sees no records until reception has checked their photo ID.
 */
export default function PendingVerificationPage() {
  const user = useAppSelector(selectCurrentUser);
  const { data: clinic } = useGetPublicSettingsQuery();
  const linked = user?.patientLinkStatus === 'linked';
  const address = clinic?.address
    ? [clinic.address.line1, clinic.address.line2, clinic.address.city].filter(Boolean).join(', ')
    : '';

  return (
    <section className="mx-auto w-full max-w-2xl">
      <Card>
        <div className="space-y-4 text-center">
          <IdCard className="mx-auto h-12 w-12 text-brand-600" aria-hidden="true" />
          <h1 className="text-2xl font-semibold">
            {linked ? 'Your records are connected' : 'Almost there – show your photo ID'}
          </h1>
          {linked ? (
            <p className="text-slate-600">The clinic has confirmed your identity.</p>
          ) : (
            <>
              <p className="text-slate-600">
                Your account has been created. We found an existing patient record with your phone
                number and date of birth. To protect it, please show a photo ID (Aadhaar, PAN,
                passport or driving licence) at the clinic reception to connect your records.
              </p>
              <p className="text-slate-600">
                Until then you are logged in, but you will not see any records.
              </p>
              {clinic && (
                <p className="text-sm text-slate-500">
                  {clinic.name}
                  {address && ` · ${address}`}
                  {clinic.phone && ` · ${formatPhone(clinic.phone)}`}
                </p>
              )}
            </>
          )}
          <Link
            to={ROLE_HOME.patient}
            className="inline-flex items-center justify-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
          >
            Go to my dashboard
          </Link>
        </div>
      </Card>
    </section>
  );
}
