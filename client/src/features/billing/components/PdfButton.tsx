import { Download } from 'lucide-react';
import toast from 'react-hot-toast';
import Button from '../../../components/ui/Button';
import type { ButtonVariant } from '../../../components/ui/buttonClass';
import { useDownload } from '../../../hooks/useFileTransfer';
import { getQueryErrorMessage } from '../../../utils/http';

/**
 * Downloads a protected PDF (invoice, receipt) with the user's token as a blob – the file is
 * never behind a public URL and never cached in the store.
 */
export default function PdfButton({
  url,
  fileName,
  label,
  variant = 'secondary',
}: {
  url: string;
  fileName: string;
  label: string;
  variant?: ButtonVariant;
}) {
  const { download, busy } = useDownload();
  return (
    <Button
      size="sm"
      variant={variant}
      loading={busy}
      onClick={() =>
        void download(url, fileName).catch((err: unknown) => toast.error(getQueryErrorMessage(err)))
      }
    >
      <Download className="h-4 w-4" aria-hidden="true" />
      {label}
    </Button>
  );
}
