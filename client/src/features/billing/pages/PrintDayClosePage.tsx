import { useSearchParams } from 'react-router-dom';
import ErrorState from '../../../components/ui/ErrorState';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import PrintLayout from '../../../layouts/PrintLayout';
import { clinicDate, formatCalendarDate, formatDateTime } from '../../../utils/dates';
import { useGetPublicSettingsQuery } from '../../settings/api';
import { useGetDaySummaryQuery } from '../api';
import DaySummaryTables from '../components/DaySummaryTables';

/** /print/day-close?date= – the day close sheet on A4, without the app chrome. */
export default function PrintDayClosePage() {
  const [params] = useSearchParams();
  const date = params.get('date') || clinicDate();
  const { data, isLoading, isError, error, refetch } = useGetDaySummaryQuery(date);
  const { data: clinic } = useGetPublicSettingsQuery();
  return (
    <PrintLayout title="Day close">
      {isLoading && <ListSkeleton label="Loading…" rows={4} />}
      {isError && <ErrorState error={error} onRetry={() => void refetch()} />}
      {data && (
        <div className="space-y-5">
          <header className="border-b-2 border-ink pb-3">
            <p className="text-xl font-bold">{clinic?.name ?? 'Clinic'}</p>
            <p className="text-base font-semibold">Day close – {formatCalendarDate(data.date)}</p>
            <p className="text-xs">Printed {formatDateTime(new Date())}</p>
          </header>
          <DaySummaryTables summary={data} />
          {data.payments.length === 0 && <p>No payments or refunds on this day.</p>}
          <footer className="flex justify-between gap-6 pt-12 text-xs">
            <p className="border-t border-ink pt-1">Counted by</p>
            <p className="border-t border-ink pt-1">Checked by</p>
          </footer>
        </div>
      )}
    </PrintLayout>
  );
}
