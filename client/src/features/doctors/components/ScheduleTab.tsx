import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import Alert from '../../../components/ui/Alert';
import Card from '../../../components/ui/Card';
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
    <div className="rounded-lg border border-slate-200 p-3">
      <p className="text-sm font-semibold text-slate-800">{title}</p>
      <p className="text-xs text-slate-500">
        From {formatDate(`${version.effectiveFrom}T12:00:00Z`)}
        {version.effectiveTo
          ? ` until ${formatDate(`${version.effectiveTo}T12:00:00Z`)}`
          : ' (no end date)'}{' '}
        · {weeklyHours(version)} h a week
      </p>
      <dl className="mt-2 grid grid-cols-[3rem_1fr] gap-x-2 gap-y-1 text-sm">
        {WEEK_ORDER.map((w) => {
          const sessions = byDay.get(w) ?? [];
          return (
            <div key={w} className="contents">
              <dt className="text-slate-500">{WEEKDAY_SHORT[w]}</dt>
              <dd>
                {sessions.length === 0
                  ? 'Off'
                  : sessions
                      .map((s) => `${formatClockTime(s.start)}–${formatClockTime(s.end)}`)
                      .join(', ')}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
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
        <div className="grid gap-4 md:grid-cols-2">
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

      <Card title="New weekly schedule">
        <p className="mb-4 text-sm text-slate-600">
          Saving replaces the schedule from the chosen date; the current one ends the day before.
        </p>
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
      </Card>
    </div>
  );
}
