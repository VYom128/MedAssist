import { useAppSelector } from '../../../app/hooks';
import PageHeader from '../../../components/PageHeader';
import { ROLE_LABELS } from '../../../constants/roles';
import { selectCurrentUser } from '../../auth/authSlice';

/** Placeholder until the real dashboards (spec §14) arrive in Phase 10. */
export default function DashboardPlaceholder({ upcoming }: { upcoming: string[] }) {
  const user = useAppSelector(selectCurrentUser);
  if (!user) return null;
  return (
    <section className="mx-auto w-full max-w-4xl">
      <PageHeader
        title={`Welcome, ${user.firstName}`}
        description={`${ROLE_LABELS[user.role]} dashboard`}
      />
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6">
        <p className="text-sm font-medium text-slate-700">Coming soon to this dashboard</p>
        <ul className="mt-3 list-inside list-disc space-y-1 text-sm text-slate-500">
          {upcoming.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
