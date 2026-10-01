import { Download, FlaskConical, Info } from 'lucide-react';
import toast from 'react-hot-toast';
import { useParams } from 'react-router-dom';
import Alert from '../../../components/ui/Alert';
import Badge from '../../../components/ui/Badge';
import Button from '../../../components/ui/Button';
import ErrorState from '../../../components/ui/ErrorState';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import PageHeader from '../../../components/ui/PageHeader';
import SectionCard from '../../../components/ui/SectionCard';
import { useDownload } from '../../../hooks/useFileTransfer';
import { formatDate, formatDateTime } from '../../../utils/dates';
import { getQueryErrorMessage } from '../../../utils/http';
import { reportUrl, useGetLabOrderQuery } from '../api';
import ResultsTable from '../components/ResultsTable';

/**
 * /patient/lab-reports/:id – one released report for the patient: per test the values, units and
 * reference ranges with High/Low shown as text and icon (never colour alone); critical values read
 * "Outside reference range – your doctor has been informed". A reminder to discuss the results
 * with the doctor, and the PDF.
 */
export default function MyLabReportPage() {
  const { id = '' } = useParams();
  const { data: report, isLoading, isError, error, refetch } = useGetLabOrderQuery(id);
  const { download, busy } = useDownload();
  const back = { to: '/patient/lab-reports', label: 'Lab reports' };
  if (isLoading || isError || !report) {
    return (
      <section>
        <PageHeader back={back} title="Lab report" />
        {isLoading ? (
          <ListSkeleton label="Loading the report…" rows={4} />
        ) : (
          <ErrorState error={error} onRetry={() => void refetch()} />
        )}
      </section>
    );
  }
  return (
    <section className="space-y-6">
      <PageHeader
        back={back}
        title={`Lab report · ${formatDate(report.releasedAt ?? report.orderedAt)}`}
        description={`Ordered by Dr ${report.orderedBy.name}${report.orderNumber ? ` · ${report.orderNumber}` : ''}`}
        actions={
          report.reportAvailable ? (
            <Button
              variant="secondary"
              loading={busy}
              onClick={() =>
                void download(reportUrl(report.id), `lab-report-${report.orderNumber}.pdf`).catch(
                  (err: unknown) => toast.error(getQueryErrorMessage(err)),
                )
              }
            >
              <Download className="h-4 w-4" aria-hidden="true" /> Download PDF
            </Button>
          ) : undefined
        }
      />
      <Alert tone="info" title="Please discuss your results with your doctor">
        <span className="inline-flex items-start gap-1.5">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />A value outside the
          reference range does not always mean something is wrong – your doctor will explain what it
          means for you.
        </span>
      </Alert>
      {report.items.map((item) => (
        <SectionCard
          key={item.id}
          title={item.name}
          icon={FlaskConical}
          iconTone="info"
          description={
            item.correctedAt ? (
              <Badge tone="info">Corrected {formatDateTime(item.correctedAt)}</Badge>
            ) : undefined
          }
        >
          <ResultsTable
            results={item.results}
            caption={`${item.name} results`}
            audience="patient"
          />
        </SectionCard>
      ))}
    </section>
  );
}
