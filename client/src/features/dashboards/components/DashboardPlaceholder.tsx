import { useAppSelector } from '../../../app/hooks';
import Badge from '../../../components/ui/Badge';
import Card from '../../../components/ui/Card';
import { ROLE_LABELS } from '../../../constants/roles';
import { selectCurrentUser } from '../../auth/authSlice';

/** Placeholder until the real dashboards (spec §14) arrive in Phase 10. */
export default function DashboardPlaceholder({ upcoming }: { upcoming: string[] }) {
  const user = useAppSelector(selectCurrentUser);
  if (!user) return null;
  return (
    <section className="mx-auto w-full max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Welcome, {user.firstName}</h1>
        <Badge tone="info">{ROLE_LABELS[user.role]}</Badge>
      </div>
      <p className="text-sm text-slate-500">{ROLE_LABELS[user.role]} dashboard</p>
      <Card title="Coming in later phases">
        <ul className="list-inside list-disc space-y-1 text-sm text-slate-600">
          {upcoming.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </Card>
    </section>
  );
}
