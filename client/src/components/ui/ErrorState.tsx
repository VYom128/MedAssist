import { CloudOff, RotateCw } from 'lucide-react';
import { getQueryErrorMessage } from '../../utils/http';
import Button from './Button';
import IconChip from './IconChip';

/** A failed load with a retry button (spec §13.3). */
export default function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center rounded-card border border-line bg-surface px-6 py-10 text-center shadow-card">
      <IconChip icon={CloudOff} tone="danger" size="lg" />
      <p className="mt-4 text-card text-ink">Something went wrong</p>
      <p role="alert" className="mt-1 max-w-md text-sm text-muted">
        {getQueryErrorMessage(error)}
      </p>
      <Button variant="secondary" onClick={onRetry} className="mt-5">
        <RotateCw className="h-4 w-4" aria-hidden="true" />
        Try again
      </Button>
    </div>
  );
}
