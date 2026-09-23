import { getQueryErrorMessage } from '../../utils/http';
import Alert from './Alert';
import Button from './Button';

/** A failed load with a retry button (spec §13.3). */
export default function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div className="space-y-3">
      <Alert tone="error">{getQueryErrorMessage(error)}</Alert>
      <Button variant="secondary" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
