import { Download, Eye, Trash2 } from 'lucide-react';
import Badge from '../../../components/ui/Badge';
import Button from '../../../components/ui/Button';
import { formatFileSize } from '../../../utils/files';
import Table, { type Column } from '../../../components/ui/Table';
import { DOCUMENT_CATEGORY_LABELS } from '../../../constants/catalog';
import { formatDateTime } from '../../../utils/dates';
import type { ClinicDocument } from '../api';

/**
 * Documents as a table (cards on phones): title and file, category, size, upload date and
 * uploader, and actions – preview, download, and delete when the caller may.
 */
export default function DocumentList({
  documents,
  onPreview,
  onDownload,
  onDelete,
  downloading,
}: {
  documents: ClinicDocument[];
  onPreview: (d: ClinicDocument) => void;
  onDownload: (d: ClinicDocument) => void;
  onDelete?: (d: ClinicDocument) => void;
  downloading?: string | null;
}) {
  const columns: Column<ClinicDocument>[] = [
    {
      key: 'title',
      header: 'Document',
      cell: (d) => (
        <span>
          <span className="block font-medium text-ink">{d.title ?? 'Document'}</span>
          <span className="block text-xs text-muted">
            {d.originalName ?? ''} · {formatFileSize(d.sizeBytes)}
          </span>
        </span>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      cell: (d) => (
        <span className="flex flex-wrap gap-1">
          <Badge tone="neutral">{DOCUMENT_CATEGORY_LABELS[d.category]}</Badge>
          {d.isGenerated && <Badge tone="info">Generated</Badge>}
        </span>
      ),
    },
    {
      key: 'uploaded',
      header: 'Added',
      cell: (d) => (
        <span className="text-sm">
          {d.uploadedAt ? formatDateTime(d.uploadedAt) : '—'}
          {d.uploadedBy?.name ? (
            <span className="block text-xs text-muted">by {d.uploadedBy.name}</span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      cardFooter: true,
      cell: (d) => (
        <span className="flex flex-wrap gap-1">
          <Button size="sm" variant="ghost" onClick={() => onPreview(d)}>
            <Eye className="h-4 w-4" aria-hidden="true" /> View
            <span className="sr-only"> {d.title}</span>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            loading={downloading === d.id}
            onClick={() => onDownload(d)}
          >
            <Download className="h-4 w-4" aria-hidden="true" /> Download
            <span className="sr-only"> {d.title}</span>
          </Button>
          {onDelete && d.canDelete && (
            <Button size="sm" variant="ghost" onClick={() => onDelete(d)}>
              <Trash2 className="h-4 w-4" aria-hidden="true" /> Delete
              <span className="sr-only"> {d.title}</span>
            </Button>
          )}
        </span>
      ),
    },
  ];
  return <Table caption="Documents" columns={columns} rows={documents} rowKey={(d) => d.id} />;
}
