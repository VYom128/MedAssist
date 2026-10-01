import { Download } from 'lucide-react';
import { useEffect, useState } from 'react';
import Alert from '../../../components/ui/Alert';
import Button from '../../../components/ui/Button';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import Modal from '../../../components/ui/Modal';
import { fetchFile, saveBlob, useBaseQueryApi } from '../../../hooks/useFileTransfer';
import { getQueryErrorMessage } from '../../../utils/http';

interface Loaded {
  url: string;
  blob: Blob;
  fileName: string;
}

/**
 * Preview of a PDF or image (spec §12.2) from an object URL made from the AUTHORISED download –
 * never a public link. The object URL is revoked when the preview closes; nothing is stored.
 */
export default function FilePreview({
  file,
  onClose,
}: {
  /** What to show: the API path of the download and a title; null = closed. */
  file: { url: string; title: string; mimeType: string; fileName: string } | null;
  onClose: () => void;
}) {
  const api = useBaseQueryApi();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = file?.url ?? null;

  useEffect(() => {
    if (!key || !file) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    void fetchFile(api, key)
      .then(({ blob, fileName }) => {
        if (cancelled || typeof URL.createObjectURL !== 'function') return;
        objectUrl = URL.createObjectURL(blob);
        setLoaded({ url: objectUrl, blob, fileName: fileName ?? file.fileName });
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(getQueryErrorMessage(err));
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setLoaded(null);
      setError(null);
    };
    // Load once per file.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <Modal
      open={file !== null}
      onClose={onClose}
      size="lg"
      title={file?.title ?? 'Preview'}
      footer={
        loaded ? (
          <Button variant="secondary" onClick={() => saveBlob(loaded.blob, loaded.fileName)}>
            <Download className="h-4 w-4" aria-hidden="true" /> Download
          </Button>
        ) : undefined
      }
    >
      {error && <Alert tone="error" title={error} />}
      {!error && !loaded && <ListSkeleton label="Loading the file…" rows={4} />}
      {loaded &&
        (file?.mimeType === 'application/pdf' ? (
          <iframe
            title={file.title}
            src={loaded.url}
            className="h-[70vh] w-full rounded-control border border-line"
          />
        ) : (
          <img
            src={loaded.url}
            alt={file?.title ?? ''}
            className="mx-auto max-h-[70vh] max-w-full rounded-control"
          />
        ))}
    </Modal>
  );
}
