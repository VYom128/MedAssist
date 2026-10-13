import {
  CalendarClock,
  CalendarPlus,
  HandCoins,
  IdCard,
  MessageSquarePlus,
  Pill,
  TestTubes,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAppSelector } from '../../../app/hooks';
import { VERIFY_IDENTITY_PATH } from '../../../routes/home';
import Alert from '../../../components/ui/Alert';
import DescriptionList from '../../../components/ui/DescriptionList';
import SectionCard from '../../../components/ui/SectionCard';
import Skeleton from '../../../components/ui/Skeleton';
import StatusPill from '../../../components/ui/StatusPill';
import { buttonClass } from '../../../components/ui/buttonClass';
import { linkClass } from '../../../components/ui/linkClass';
import { formatDate, formatDateTime } from '../../../utils/dates';
import { selectCurrentUser } from '../../auth/authSlice';
import OutstandingBalanceCard from '../../billing/components/OutstandingBalanceCard';
import OpenFollowupsCard from '../../followups/components/OpenFollowupsCard';
import { useGetMyPatientQuery } from '../../patients/api';
import MyTokenCard from '../../queue/components/MyTokenCard';
import { useGetPublicSettingsQuery } from '../../settings/api';
import FollowUpDueCard from '../../visits/components/FollowUpDueCard';
import { useGetPatientDashboardQuery } from '../api';
import DashboardHeader from '../components/DashboardHeader';
import { ListWidget, StatWidget, WidgetError } from '../components/widgets';

/** "My details" card: MRN and a link to the profile. */
function MyDetailsCard() {
  const { data: patient, isLoading, isError, error, refetch } = useGetMyPatientQuery();
  return (
    <SectionCard
      title="My details"
      icon={IdCard}
      actions={
        <Link to="/patient/profile" className={`text-sm ${linkClass}`}>
          View profile
        </Link>
      }
    >
      {isLoading && (
        <div role="status" className="grid gap-4 sm:grid-cols-2">
          <span className="sr-only">Loading…</span>
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      )}
      {isError && <WidgetError error={error} onRetry={() => void refetch()} />}
      {patient && (
        <DescriptionList
          items={[
            {
              label: 'Patient number (MRN)',
              value: <span className="tabular font-mono">{patient.mrn}</span>,
            },
            { label: 'Name', value: patient.fullName },
          ]}
        />
      )}
    </SectionCard>
  );
}

/**
 * Patient home (spec §14), from one call (/dashboard/patient, Phase 10): the token while checked
 * in (live, its own query), the outstanding balance, follow-ups to book, the next appointment,
 * active prescriptions, new lab reports, open follow-up requests and "My details". Optional
 * cards disappear when they have nothing to show. While a self-signup waits for the ID check,
 * only a banner is shown.
 */
export default function PatientDashboard() {
  const user = useAppSelector(selectCurrentUser);
  const { data: clinic } = useGetPublicSettingsQuery();
  const linked = user?.patientLinkStatus !== 'pending_verification' && Boolean(user?.patientId);
  const q = useGetPatientDashboardQuery(undefined, { skip: !linked });
  const d = q.data;
  const canBook = clinic?.appointment.allowPatientSelfBooking !== false;

  if (user?.patientLinkStatus === 'pending_verification') {
    return (
      <section>
        <DashboardHeader />
        <Alert tone="warning" title="Please verify your identity at the clinic">
          <p>
            Show a photo ID at the reception desk to connect your records. Until then, your
            appointments and records are not shown here.
          </p>
          <Link
            to={VERIFY_IDENTITY_PATH}
            className="mt-2 inline-flex items-center gap-1 rounded font-semibold underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-warning-700"
          >
            <IdCard className="h-4 w-4" aria-hidden="true" /> What to bring
          </Link>
        </Alert>
      </section>
    );
  }

  const actions = (
    <>
      {canBook && (
        <Link to="/patient/appointments/book" className={buttonClass('primary')}>
          <CalendarPlus className="h-4 w-4" aria-hidden="true" /> Book appointment
        </Link>
      )}
      <Link to="/patient/follow-ups/new" className={buttonClass('secondary')}>
        <MessageSquarePlus className="h-4 w-4" aria-hidden="true" /> Ask the clinic
      </Link>
    </>
  );

  return (
    <section className="space-y-4">
      <DashboardHeader actions={linked ? actions : undefined} />
      {linked && (
        <>
          <MyTokenCard />
          {q.isLoading || q.isError ? (
            <StatWidget
              q={q}
              label="Outstanding balance"
              icon={HandCoins}
              render={() => ({ value: '' })}
            />
          ) : (
            d && (
              <OutstandingBalanceCard
                balancePaise={d.outstanding.balancePaise}
                invoices={d.outstanding.invoices}
              />
            )
          )}
          {d && <FollowUpDueCard items={d.followUpsDue} />}
          <div className="grid gap-4 lg:grid-cols-2">
            <ListWidget
              q={q}
              title="Next appointment"
              icon={CalendarClock}
              actions={
                <Link to="/patient/appointments" className={`text-sm ${linkClass}`}>
                  All appointments
                </Link>
              }
              isEmpty={() => !d!.nextAppointment}
              emptyText="No upcoming appointments."
            >
              {() => {
                const next = d!.nextAppointment!;
                return (
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="tabular text-card text-ink">{formatDateTime(next.startAt)}</p>
                      <p className="mt-0.5 text-sm text-body">
                        {next.doctorName}
                        {next.department ? ` · ${next.department}` : ''}
                      </p>
                      <p className="tabular mt-0.5 text-xs text-muted">{next.appointmentNumber}</p>
                    </div>
                    <StatusPill domain="appointment" status={next.status} />
                  </div>
                );
              }}
            </ListWidget>
            <ListWidget
              q={q}
              title="Active prescriptions"
              icon={Pill}
              hideWhenEmpty
              actions={
                <Link to="/patient/prescriptions" className={`text-sm ${linkClass}`}>
                  All prescriptions
                </Link>
              }
              isEmpty={() => d!.activePrescriptions.items.length === 0}
            >
              {() => (
                <ul className="space-y-2">
                  {d!.activePrescriptions.items.map((p) => (
                    <li key={p.id} className="text-sm">
                      <Link to={`/patient/prescriptions/${p.id}`} className={linkClass}>
                        {p.prescriptionNumber ?? 'Prescription'}
                        {p.doctorName ? ` · ${p.doctorName}` : ''}
                      </Link>
                      {p.issuedAt && (
                        <span className="tabular block text-muted">
                          Issued {formatDate(p.issuedAt)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </ListWidget>
            <ListWidget
              q={q}
              title="New lab reports"
              description={d ? `Released in the last ${d.newReports.sinceDays} days` : undefined}
              icon={TestTubes}
              iconTone="info"
              hideWhenEmpty
              actions={
                <Link to="/patient/lab-reports" className={`text-sm ${linkClass}`}>
                  All reports
                </Link>
              }
              isEmpty={() => d!.newReports.items.length === 0}
            >
              {() => (
                <ul className="space-y-2">
                  {d!.newReports.items.map((o) => (
                    <li key={o.id} className="text-sm">
                      <Link to={`/patient/lab-reports/${o.id}`} className={linkClass}>
                        Lab report {o.orderNumber ?? ''}
                      </Link>
                      <span className="tabular block text-muted">
                        Released {formatDate(o.releasedAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </ListWidget>
            <OpenFollowupsCard />
            <MyDetailsCard />
          </div>
        </>
      )}
    </section>
  );
}
