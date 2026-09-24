import { CalendarClock, CalendarPlus } from 'lucide-react';
import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import Alert from '../../../components/ui/Alert';
import SectionCard from '../../../components/ui/SectionCard';
import ErrorState from '../../../components/ui/ErrorState';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import { WEEK_ORDER, WEEKDAY_SHORT } from '../../../constants/catalog';
import { clinicDate, formatClockTime, formatDate } from '../../../utils/dates';
import {
  useGetScheduleQuery,
  useReplaceScheduleMutation,
  type ScheduleSaveResult,
  type ScheduleVersion,
} from '../api';
import { toScheduleForm, weeklyHours } from '../schemas';
import ScheduleEditor from './ScheduleEditor';

function VersionSummary({ title, version }: { title: string; version: ScheduleVersion }) {
  const byDay = new Map(version.days.map((d) => [d.weekday, d.sessions]));
  return (
    <SectionCard
      title={title}
      icon={CalendarClock}
      description={
        <>
          From {formatDate(`${version.effectiveFrom}T12:00:00Z`)}
          {version.effectiveTo
            ? ` until ${formatDate(`${version.effectiveTo}T12:00:00Z`)}`
            : ' (no end date)'}{' '}
          · <span className="tabular">{weeklyHours(version)}</span> h a week
        </>
      }
    >
      <dl className="grid gap-2 text-sm lg:grid-cols-7">
        {WEEK_ORDER.map((w) => {
          const sessions = byDay.get(w) ?? [];
          return (
            <div
              key={w}
              className={`flex items-start gap-3 rounded-control border p-2.5 lg:flex-col lg:gap-2 ${
                sessions.length === 0
                  ? 'border-dashed border-line-strong'
                  : 'border-line bg-surface-muted'
              }`}
            >
              <dt className="w-10 shrink-0 pt-0.5 font-semibold text-ink lg:w-auto">
                {WEEKDAY_SHORT[w]}
              </dt>
              <dd className="flex min-w-0 flex-wrap gap-1.5 lg:flex-col">
                {sessions.length === 0 ? (
                  <span className="pt-0.5 text-muted">Off</span>
                ) : (
                  sessions.map((s) => (
                    <span
                      key={`${s.start}-${s.end}`}
                      className="tabular rounded-full bg-primary-50 px-2.5 py-1 text-xs font-semibold whitespace-nowrap text-primary-700 ring-1 ring-primary-100 ring-inset"
                    >
                      {formatClockTime(s.start)}–{formatClockTime(s.end)}
                    </span>
                  ))
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </SectionCard>
  );
}

/**
 * A doctor's weekly schedule: the current and upcoming versions, and the editor for a new version
 * (starting from the upcoming one, else the current one). Used by admins and by doctors for
 * themselves.
 */
export default function ScheduleTab({ doctorId }: { doctorId: string }) {
  const { data, isLoading, isError, error, refetch } = useGetScheduleQuery(doctorId);
  const [replace, { isLoading: saving }] = useReplaceScheduleMutation();
  const [result, setResult] = useState<ScheduleSaveResult | null>(null);

  const initial = useMemo(
    () => toScheduleForm(clinicDate(), data ? (data.upcoming ?? data.current) : null),
    [data],
  );

  if (isLoading) return <ListSkeleton label="Loading schedule…" rows={5} />;
  if (isError) return <ErrorState error={error} onRetry={() => void refetch()} />;

  return (
    <div className="space-y-6">
      {data && (data.current || data.upcoming) ? (
        <div className="space-y-4">
          {data.current && <VersionSummary title="Current schedule" version={data.current} />}
          {data.upcoming && <VersionSummary title="Upcoming schedule" version={data.upcoming} />}
        </div>
      ) : (
        <Alert tone="info">No weekly schedule yet. Add sessions below and save.</Alert>
      )}

      {result && result.warnings.length > 0 && (
        <Alert tone="warning" title="Saved with warnings">
          <ul className="list-disc pl-5">
            {result.warnings.map((w) => (
              <li key={w.weekday}>{w.message}</li>
            ))}
          </ul>
        </Alert>
      )}

      <SectionCard
        title="New weekly schedule"
        description="Saving replaces the schedule from the chosen date; the current one ends the day before."
        icon={CalendarPlus}
      >
        <ScheduleEditor
          initial={initial}
          saving={saving}
          onSave={async (body) => {
            const saved = await replace({ id: doctorId, body }).unwrap();
            setResult(saved);
            toast.success(
              saved.warnings.length > 0 ? 'Schedule saved with warnings' : 'Schedule saved',
            );
          }}
        />
      </SectionCard>
    </div>
  );
}
