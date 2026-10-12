import { BadgeCheck, RotateCw, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useAppDispatch } from '../../../app/hooks';
import Alert from '../../../components/ui/Alert';
import Badge from '../../../components/ui/Badge';
import Button from '../../../components/ui/Button';
import ErrorState from '../../../components/ui/ErrorState';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import Spinner from '../../../components/ui/Spinner';
import type { Encounter } from '../../encounters/api';
import { settingsApi } from '../../settings/api';
import { useGenerateSummaryMutation, useGetSummaryQuery, type ClinicalSummary } from '../api';
import { aiError, type AiErrorInfo } from '../errors';
import { reviewedLine } from '../format';
import SummaryDraftReview from './SummaryDraftReview';

/** An approved summary: the reviewed label, "Shared with patient" and the text. */
export function ApprovedSummary({ summary }: { summary: ClinicalSummary }) {
  return (
    <div className="rounded-control border border-success-100 bg-success-50 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="success" icon={BadgeCheck}>
          {reviewedLine(summary)}
        </Badge>
        {summary.shareWithPatient && <Badge tone="info">Shared with patient</Badge>}
      </div>
      <p className="mt-3 text-sm whitespace-pre-line text-body">{summary.finalText}</p>
      {summary.isOutdated && (
        <p className="mt-3 text-xs text-muted">
          The note was amended after this summary was approved.
        </p>
      )}
    </div>
  );
}

/** Generation failures in the summary's own words (the rest of the workspace keeps working). */
function GenerateError({ info, onRetry }: { info: AiErrorInfo; onRetry: () => void }) {
  const retry = (
    <div className="mt-2">
      <Button size="sm" variant="secondary" onClick={onRetry}>
        <RotateCw className="h-4 w-4" aria-hidden="true" /> Retry
      </Button>
    </div>
  );
  switch (info.kind) {
    case 'busy':
      return (
        <Alert tone="warning" title="The AI is busy – try again in a minute">
          {retry}
        </Alert>
      );
    case 'daily_limit':
      return (
        <Alert tone="warning" title="Daily AI limit reached">
          AI summaries are available again tomorrow. You can write the summary yourself.
        </Alert>
      );
    case 'invalid':
      return (
        <Alert tone="error" title="The AI summary couldn't be generated.">
          You can write the summary yourself.
        </Alert>
      );
    default:
      return (
        <Alert tone="error" title="The summary was not generated">
          {info.message} You can write the summary yourself.
          {info.retry && retry}
        </Alert>
      );
  }
}

/**
 * The AI clinical summary of one note (spec §4.11, §9.2): generate (with a cancellable wait),
 * review the draft next to the note, approve or reject – for the note's own doctor; the approved
 * summary for every doctor who may read the note. `onDisabled` runs when the server says AI is
 * off (AI_DISABLED), so the workspace can hide the tab.
 */
export default function AiSummaryPanel({
  encounter,
  canEdit,
  onDisabled,
}: {
  /** The note the summary is made from (shown next to the draft). */
  encounter: Encounter;
  /** The note's own doctor, with AI summaries turned on. */
  canEdit: boolean;
  onDisabled?: () => void;
}) {
  const dispatch = useAppDispatch();
  const state = useGetSummaryQuery(encounter.id, { refetchOnMountOrArgChange: true });
  const [generate, generating] = useGenerateSummaryMutation();
  const pending = useRef<{ abort: () => void } | null>(null);
  const stoppedRef = useRef(false);
  const [error, setError] = useState<AiErrorInfo | null>(null);
  const [stopped, setStopped] = useState(false);

  useEffect(() => () => pending.current?.abort(), []);

  const disabled = () => {
    // Refresh the kill switches so every AI button disappears, then hide this tab.
    dispatch(settingsApi.util.invalidateTags([{ type: 'Settings', id: 'PUBLIC' }]));
    onDisabled?.();
  };

  const start = () => {
    setError(null);
    setStopped(false);
    stoppedRef.current = false;
    const request = generate(encounter.id);
    pending.current = request;
    request
      .unwrap()
      .catch((err: unknown) => {
        if (stoppedRef.current) return;
        const info = aiError(err);
        if (info.kind === 'disabled') disabled();
        else setError(info);
      })
      .finally(() => {
        if (pending.current === request) pending.current = null;
      });
  };
  const stop = () => {
    stoppedRef.current = true;
    pending.current?.abort();
    setStopped(true);
  };

  if (state.isLoading) return <ListSkeleton label="Loading the AI summary…" rows={2} />;
  if (state.isError) {
    if (aiError(state.error).kind === 'disabled') return null;
    return <ErrorState error={state.error} onRetry={() => void state.refetch()} />;
  }
  const s = state.data;
  if (!s) return null;
  const mayGenerate = canEdit && s.aiEnabled;
  const draft = s.draft;

  if (generating.isLoading) {
    return (
      <div
        role="status"
        className="flex flex-col items-center gap-3 rounded-control border border-line bg-surface-muted p-6 text-center"
      >
        <Spinner className="h-6 w-6 text-primary-600" />
        <div>
          <p className="font-semibold text-ink">Generating the summary…</p>
          <p className="text-sm text-muted">This can take up to 30 seconds.</p>
        </div>
        <Button variant="secondary" size="sm" onClick={stop}>
          Stop waiting
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {s.approved && <ApprovedSummary summary={s.approved} />}

      {error && <GenerateError info={error} onRetry={start} />}
      {stopped && (
        <Alert tone="info" title="Stopped waiting">
          If the AI still finishes, its draft appears here.
          <div className="mt-2">
            <Button size="sm" variant="secondary" onClick={() => void state.refetch()}>
              <RotateCw className="h-4 w-4" aria-hidden="true" /> Check again
            </Button>
          </div>
        </Alert>
      )}

      {draft?.status === 'generating' && (
        <Alert tone="info" title="A summary is being generated">
          It was started elsewhere and appears here when it is ready.
          <div className="mt-2">
            <Button size="sm" variant="secondary" onClick={() => void state.refetch()}>
              <RotateCw className="h-4 w-4" aria-hidden="true" /> Check again
            </Button>
          </div>
        </Alert>
      )}

      {draft?.status === 'draft' && canEdit && (
        <SummaryDraftReview
          summary={draft}
          encounter={encounter}
          noteSigned={s.noteSigned}
          canRegenerate={mayGenerate}
          onRegenerate={start}
        />
      )}

      {!draft && mayGenerate && (
        <div className="flex flex-col items-start gap-3 rounded-control border border-dashed border-line-strong p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-consult-700" aria-hidden="true" />
            <div>
              <p className="font-semibold text-ink">
                {s.approved ? 'Generate a new summary' : 'AI summary of this note'}
              </p>
              <p className="text-sm text-muted">
                A draft written by AI from this note for you to review, edit and approve. It never
                changes the note.
                {s.lastAttempt?.status === 'rejected' && ' Your last draft was rejected.'}
                {s.lastAttempt?.status === 'failed' &&
                  !error &&
                  ' The last attempt failed – you can try again.'}
              </p>
            </div>
          </div>
          <Button onClick={start}>
            <Sparkles className="h-4 w-4" aria-hidden="true" /> Generate summary
          </Button>
        </div>
      )}

      {!draft && !s.approved && !mayGenerate && (
        <p className="text-sm text-muted">No approved AI summary for this note.</p>
      )}
    </div>
  );
}
