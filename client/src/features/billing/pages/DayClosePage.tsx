import { CalendarCheck2, HandCoins, Printer, Undo, Wallet } from 'lucide-react';
import { Link } from 'react-router-dom';
import EmptyState from '../../../components/ui/EmptyState';
import ErrorState from '../../../components/ui/ErrorState';
import FilterBar from '../../../components/ui/FilterBar';
import Input from '../../../components/ui/Input';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import PageHeader from '../../../components/ui/PageHeader';
import SectionCard from '../../../components/ui/SectionCard';
import StatCard from '../../../components/ui/StatCard';
import { buttonClass } from '../../../components/ui/buttonClass';
import { useListParams } from '../../../hooks/useListParams';
import { clinicDate, formatCalendarDate } from '../../../utils/dates';
import { formatINR } from '../../../utils/money';
import { useGetDaySummaryQuery } from '../api';
import DaySummaryTables from '../components/DaySummaryTables';

/**
 * /reception/billing/day-close – the clinic day's collections for closing the till: totals per
 * method (payments, refunds, net) and every payment, with a print-friendly sheet.
 */
export default function DayClosePage() {
  const params = useListParams();
  const date = params.get('date') || clinicDate();
  const { data, isLoading, isError, error, refetch } = useGetDaySummaryQuery(date);

  return (
    <section>
      <PageHeader
        title="Day close"
        description="Payments and refunds taken on a clinic day, by method."
        actions={
          <Link to={`/print/day-close?date=${date}`} className={buttonClass('secondary')}>
            <Printer className="h-4 w-4" aria-hidden="true" /> Print
          </Link>
        }
      />
      <div className="space-y-4">
        <FilterBar label="Choose the day">
          <Input
            label="Date"
            type="date"
            value={date}
            max={clinicDate()}
            onChange={(e) => params.update({ date: e.target.value })}
          />
        </FilterBar>
        {isLoading && <ListSkeleton label="Loading the day's payments…" rows={4} />}
        {isError && <ErrorState error={error} onRetry={() => void refetch()} />}
        {data && (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <StatCard
                label="Collected"
                value={<span className="tabular">{formatINR(data.totals.collectedPaise)}</span>}
                icon={Wallet}
                tone="success"
                hint={`${data.totals.paymentCount} payments`}
              />
              <StatCard
                label="Refunded"
                value={<span className="tabular">{formatINR(data.totals.refundedPaise)}</span>}
                icon={Undo}
                tone="warning"
                hint={`${data.totals.refundCount} refunds`}
              />
              <StatCard
                label="Net"
                value={<span className="tabular">{formatINR(data.totals.netPaise)}</span>}
                icon={HandCoins}
                tone="primary"
                hint={formatCalendarDate(data.date)}
              />
            </div>
            <SectionCard
              title={`Collections on ${formatCalendarDate(data.date)}`}
              icon={CalendarCheck2}
            >
              {data.payments.length === 0 ? (
                <EmptyState
                  icon={Wallet}
                  title="No payments on this day"
                  description="Payments and refunds recorded at the desk appear here."
                />
              ) : (
                <DaySummaryTables summary={data} />
              )}
            </SectionCard>
          </>
        )}
      </div>
    </section>
  );
}
