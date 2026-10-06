import { FileText, Upload } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import toast from 'react-hot-toast';
import { useAppSelector } from '../../../app/hooks';
import Button from '../../../components/ui/Button';
import EmptyState from '../../../components/ui/EmptyState';
import ErrorState from '../../../components/ui/ErrorState';
import FileUpload from '../../../components/ui/FileUpload';
import Input from '../../../components/ui/Input';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import ReasonDialog from '../../../components/ui/ReasonDialog';
import SectionCard from '../../../components/ui/SectionCard';
import Select from '../../../components/ui/Select';
import {
  DOCUMENT_CATEGORY_LABELS,
  DOCUMENT_UPLOAD_CATEGORIES,
  UPLOAD_RULES,
  type DocumentCategory,
} from '../../../constants/catalog';
import { useDownload } from '../../../hooks/useFileTransfer';
import { getQueryErrorMessage } from '../../../utils/http';
import { selectCurrentUser } from '../../auth/authSlice';
import {
  downloadUrl,
  useDeleteDocumentMutation,
  useListDocumentsQuery,
  useUploadDocument,
  type ClinicDocument,
} from '../api';
import DocumentList from './DocumentList';
import FilePreview from './FilePreview';

/** The upload form: category (the caller's allowed ones), title, file. */
function UploadForm({ patientId, onDone }: { patientId: string; onDone: () => void }) {
  const user = useAppSelector(selectCurrentUser);
  const categories = DOCUMENT_UPLOAD_CATEGORIES[user?.role ?? ''] ?? [];
  const [category, setCategory] = useState<DocumentCategory | ''>(categories[0] ?? '');
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<{ title?: string; file?: string; server?: string }>({});
  const { uploadDocument, progress } = useUploadDocument();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (!title.trim()) next.title = 'Give the document a title';
    if (!file) next.file = 'Choose a file';
    setErrors(next);
    if (next.title || next.file || !category || !file) return;
    try {
      await uploadDocument({ file, patientId, category, title: title.trim() });
      toast.success('Document uploaded');
      setTitle('');
      setFile(null);
      onDone();
    } catch (err) {
      // 413/415 and other refusals come back with a clear message.
      setErrors({ server: getQueryErrorMessage(err) });
    }
  };

  return (
    <form
      onSubmit={(e) => void submit(e)}
      noValidate
      className="space-y-3"
      aria-label="Upload a document"
    >
      <div className="grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
        <Select
          label="Category"
          options={categories.map((c) => ({ value: c, label: DOCUMENT_CATEGORY_LABELS[c] }))}
          value={category}
          onChange={(e) => setCategory(e.target.value as DocumentCategory)}
        />
        <Input
          label="Title"
          maxLength={UPLOAD_RULES.titleMax}
          error={errors.title}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <FileUpload
        label="File"
        file={file}
        onChange={(f) => {
          setFile(f);
          setErrors((er) => ({ ...er, file: undefined, server: undefined }));
        }}
        progress={progress}
        error={errors.file ?? errors.server}
        disabled={progress !== null}
      />
      <div className="flex justify-end">
        <Button type="submit" loading={progress !== null}>
          <Upload className="h-4 w-4" aria-hidden="true" /> Upload
        </Button>
      </div>
    </form>
  );
}

/**
 * A patient's documents (spec §7.16, §12.2): the list the caller may see, preview and download
 * through the authorised endpoint, delete (uploader within 24 h, admins), and – when the caller's
 * role may upload – an upload form with drag-and-drop and progress.
 */
export default function DocumentsPanel({
  patientId,
  title = 'Documents',
  canUpload = true,
}: {
  patientId: string;
  title?: string;
  canUpload?: boolean;
}) {
  const list = useListDocumentsQuery({ patient: patientId, limit: 50 });
  const [remove, removing] = useDeleteDocumentMutation();
  const { download } = useDownload();
  const [downloading, setDownloading] = useState<string | null>(null);
  const [preview, setPreview] = useState<ClinicDocument | null>(null);
  const [toDelete, setToDelete] = useState<ClinicDocument | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const onDownload = (d: ClinicDocument) => {
    setDownloading(d.id);
    void download(downloadUrl(d.id), d.originalName ?? 'document')
      .catch((err: unknown) => toast.error(getQueryErrorMessage(err)))
      .finally(() => setDownloading(null));
  };

  return (
    <SectionCard
      title={title}
      icon={FileText}
      iconTone="info"
      actions={
        canUpload && !uploading ? (
          <Button size="sm" variant="secondary" onClick={() => setUploading(true)}>
            <Upload className="h-4 w-4" aria-hidden="true" /> Upload
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-4">
        {canUpload && uploading && (
          <div className="rounded-control border border-line p-4">
            <UploadForm patientId={patientId} onDone={() => setUploading(false)} />
          </div>
        )}
        {list.isLoading && <ListSkeleton label="Loading documents…" rows={3} />}
        {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
        {list.data && list.data.items.length === 0 && (
          <EmptyState icon={FileText} title="No documents yet" />
        )}
        {list.data && list.data.items.length > 0 && (
          <DocumentList
            documents={list.data.items}
            downloading={downloading}
            onPreview={setPreview}
            onDownload={onDownload}
            onDelete={(d) => {
              setDeleteError(null);
              setToDelete(d);
            }}
          />
        )}
      </div>
      <FilePreview
        file={
          preview
            ? {
                url: downloadUrl(preview.id),
                title: preview.title ?? 'Document',
                mimeType: preview.mimeType,
                fileName: preview.originalName ?? 'document',
              }
            : null
        }
        onClose={() => setPreview(null)}
      />
      <ReasonDialog
        open={toDelete !== null}
        title={`Delete "${toDelete?.title ?? 'document'}"?`}
        label="Reason"
        confirmLabel="Delete"
        tone="danger"
        minLength={UPLOAD_RULES.deleteReasonMin}
        loading={removing.isLoading}
        error={deleteError}
        onCancel={() => setToDelete(null)}
        onSubmit={(reason) =>
          void remove({ id: toDelete!.id, reason })
            .unwrap()
            .then(() => {
              toast.success('Document deleted');
              setToDelete(null);
            })
            .catch((err: unknown) => setDeleteError(getQueryErrorMessage(err)))
        }
      >
        It disappears from every list. The record of the upload is kept.
      </ReasonDialog>
    </SectionCard>
  );
}
