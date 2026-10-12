import { Check, CircleSlash, RefreshCw, Save, Sparkles } from 'lucide-react';
import { useId, useState } from 'react';
import toast from 'react-hot-toast';
import Alert from '../../../components/ui/Alert';
import Button from '../../../components/ui/Button';
import Modal from '../../../components/ui/Modal';
import ReasonDialog from '../../../components/ui/ReasonDialog';
import Textarea from '../../../components/ui/Textarea';
import { formatDateTime } from '../../../utils/dates';
import { getQueryErrorMessage } from '../../../utils/http';
import type { Encounter } from '../../encounters/api';
import EncounterReadView from '../../encounters/components/EncounterReadView';
import {
  useApproveSummaryMutation,
  useRejectSummaryMutation,
  useUpdateSummaryMutation,
  type ClinicalSummary,
  type SummaryDraft,
} from '../api';
import { flagText } from '../flags';
import { approveBlockers } from '../format';
import { useScrolledToEnd } from '../useScrolledToEnd';

/** Server limits (AI_RULES). */
const FINAL_TEXT_MAX = 4000;
const REJECTION_REASON_MIN = 10;

function DraftSection({ title, value }: { title: string; value: string | string[] }) {
  const items = Array.isArray(value) ? value.filter(Boolean) : value ? [value] : [];
  return (
    <div>
      <h4 className="text-xs font-semibold tracking-wide text-muted uppercase">{title}</h4>
      {items.length === 0 ? (
        <p className="mt-1 text-sm text-subtle">—</p>
      ) : Array.isArray(value) ? (
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-body">
          {items.map((v, i) => (
            <li key={i}>{v}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-sm whitespace-pre-line text-body">{items[0]}</p>
      )}
    </div>
  );
}

/** The structured AI draft, section by section. */
function DraftSections({ draft }: { draft: SummaryDraft }) {
  return (
    <div className="space-y-4">
      {draft.flagsForClinician.length > 0 && (
        <div className="rounded-control border border-warning-100 bg-warning-50 p-3">
          <h4 className="text-sm font-semibold text-warning-700">For you to check</h4>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-warning-700">
            {draft.flagsForClinician.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
      )}
      <DraftSection title="In one line" value={draft.oneLineSummary} />
      <DraftSection title="Presenting complaint" value={draft.presentingComplaint} />
      <DraftSection title="Key findings" value={draft.keyFindings} />
      <DraftSection title="Vitals" value={draft.vitalsHighlights} />
      <DraftSection title="Assessment" value={draft.assessment} />
      <DraftSection title="Plan" value={draft.plan} />
      <DraftSection title="Medications" value={draft.medications} />
      <DraftSection title="Investigations" value={draft.investigations} />
      <DraftSection title="Follow-up" value={draft.followUp} />
    </div>
  );
}

/**
 * Review of an AI draft (spec §9.2 UI rules): the yellow "AI draft" banner, the draft next to
 * its source note (stacked on small screens), the server's checks in plain words, the editable
 * text, and Approve / Reject / Regenerate. Approve waits until the whole draft was scrolled
 * through, the note is signed and the draft is current – each missing condition is spelled out.
 */
export default function SummaryDraftReview({
  summary,
  encounter,
  noteSigned,
  canRegenerate,
  onRegenerate,
}: {
  summary: ClinicalSummary;
  encounter: Encounter;
  noteSigned: boolean;
  canRegenerate: boolean;
  onRegenerate: () => void;
}) {
  const reasonsId = useId();
  // The doctor's edit belongs to one server text: a save or reload brings the server's text back.
  const serverText = summary.finalText ?? '';
  const editKey = `${summary.id}:${serverText}`;
  const [edit, setEdit] = useState<{ key: string; text: string } | null>(null);
  const text = edit?.key === editKey ? edit.text : serverText;
  const setText = (value: string) => setEdit({ key: editKey, text: value });
  const [approveOpen, setApproveOpen] = useState(false);
  const [share, setShare] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [save, saving] = useUpdateSummaryMutation();
  const [approve, approving] = useApproveSummaryMutation();
  const [reject, rejecting] = useRejectSummaryMutation();
  const draftScroll = useScrolledToEnd<HTMLDivElement>(summary.id);
  const { attach: attachDraft, onScroll: onDraftScroll } = draftScroll;

  const unsaved = text !== serverText;
  const blockers = approveBlockers({
    scrolled: draftScroll.atEnd,
    noteSigned,
    isOutdated: summary.isOutdated,
    unsaved,
    empty: !text.trim(),
  });
  const ids = { encounterId: summary.encounterId, summaryId: summary.id };

  const onSave = async () => {
    try {
      await save({ ...ids, expectedVersion: summary.revision, finalText: text.trim() }).unwrap();
      toast.success('Summary text saved');
    } catch (err) {
      toast.error(getQueryErrorMessage(err));
    }
  };
  const onApprove = async () => {
    try {
      await approve({
        ...ids,
        shareWithPatient: share,
        expectedVersion: summary.revision,
      }).unwrap();
      setApproveOpen(false);
      toast.success(share ? 'Summary approved and shared with the patient' : 'Summary approved');
    } catch (err) {
      toast.error(getQueryErrorMessage(err));
    }
  };
  const onReject = async (reason: string) => {
    try {
      await reject({ ...ids, reason }).unwrap();
      setRejectOpen(false);
      toast.success('Draft rejected');
    } catch (err) {
      toast.error(getQueryErrorMessage(err));
    }
  };

  return (
    <div className="space-y-4">
      <Alert tone="warning" title="AI draft – review before use">
        Written by AI from this note. Check every line against the note; nothing is added to the
        record or shown to the patient until you approve it.
        {summary.generatedAt && (
          <span className="mt-1 block text-xs">
            Generated {formatDateTime(summary.generatedAt)}
            {summary.model ? ` · ${summary.model}` : ''}
          </span>
        )}
      </Alert>

      {summary.isOutdated && (
        <Alert tone="warning" title="Out of date – regenerate">
          <p>The note changed after this draft was generated, so it may not match the note.</p>
          {canRegenerate && (
            <div className="mt-2">
              <Button size="sm" variant="secondary" onClick={onRegenerate}>
                <RefreshCw className="h-4 w-4" aria-hidden="true" /> Regenerate
              </Button>
            </div>
          )}
        </Alert>
      )}

      {summary.serverFlags.length > 0 && (
        <Alert tone="info" title="Checked by the clinic’s safety rules">
          <ul className="list-disc space-y-0.5 pl-5">
            {summary.serverFlags.map((f) => (
              <li key={f}>{flagText(f)}</li>
            ))}
          </ul>
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-labelledby={`${reasonsId}-note`} className="min-w-0">
          <h3 id={`${reasonsId}-note`} className="mb-2 text-card text-ink">
            Source note
          </h3>
          <div className="max-h-[28rem] overflow-y-auto rounded-control border border-line bg-surface-muted p-4">
            <EncounterReadView encounter={encounter} />
          </div>
        </section>
        <section aria-labelledby={`${reasonsId}-draft`} className="min-w-0">
          <h3
            id={`${reasonsId}-draft`}
            className="mb-2 flex items-center gap-1.5 text-card text-ink"
          >
            <Sparkles className="h-4 w-4 text-consult-700" aria-hidden="true" /> AI draft
          </h3>
          <div
            ref={attachDraft}
            onScroll={onDraftScroll}
            role="region"
            aria-label="AI draft sections"
            tabIndex={0}
            data-scroll-region="ai-draft"
            className="max-h-[28rem] overflow-y-auto rounded-control border border-warning-100 p-4 focus-visible:outline-2 focus-visible:outline-primary-600"
          >
            {summary.aiDraft ? (
              <DraftSections draft={summary.aiDraft} />
            ) : (
              <p className="text-sm text-muted">The draft has no structured sections.</p>
            )}
            <p className="mt-6 border-t border-line pt-3 text-center text-xs text-subtle">
              End of the AI draft
            </p>
          </div>
        </section>
      </div>

      <Textarea
        label="Summary text"
        hint={`This text is what gets approved${summary.editedByDoctor ? ' (edited by you)' : ''}. ${text.length}/${FINAL_TEXT_MAX}`}
        value={text}
        maxLength={FINAL_TEXT_MAX}
        rows={8}
        onChange={(e) => setText(e.target.value)}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={() => setApproveOpen(true)}
          disabled={blockers.length > 0}
          aria-describedby={blockers.length ? reasonsId : undefined}
        >
          <Check className="h-4 w-4" aria-hidden="true" /> Approve
        </Button>
        <Button
          variant="secondary"
          onClick={() => void onSave()}
          disabled={!unsaved || !text.trim()}
          loading={saving.isLoading}
        >
          <Save className="h-4 w-4" aria-hidden="true" /> Save text
        </Button>
        <Button variant="secondary" onClick={() => setRejectOpen(true)}>
          <CircleSlash className="h-4 w-4" aria-hidden="true" /> Reject
        </Button>
        {canRegenerate && !summary.isOutdated && (
          <Button variant="ghost" onClick={onRegenerate}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" /> Regenerate
          </Button>
        )}
      </div>
      {blockers.length > 0 && (
        <div id={reasonsId} className="text-sm text-muted">
          <p className="font-semibold text-ink">Approve is not available yet:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      )}

      <Modal
        open={approveOpen}
        title="Approve the summary?"
        onClose={() => setApproveOpen(false)}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setApproveOpen(false)}
              disabled={approving.isLoading}
            >
              Cancel
            </Button>
            <Button onClick={() => void onApprove()} loading={approving.isLoading}>
              Approve
            </Button>
          </>
        }
      >
        <p className="text-sm text-body">
          You confirm you have reviewed this AI-assisted summary against the note. It is marked
          “AI-assisted · reviewed by you” wherever it is shown.
        </p>
        <label className="mt-4 flex min-h-11 items-start gap-3 rounded-control border border-line bg-surface-muted p-3 text-sm">
          <input
            type="checkbox"
            checked={share}
            onChange={(e) => setShare(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-primary-600"
          />
          <span>
            <span className="font-semibold text-ink">Share with patient</span>
            <span className="block text-muted">
              The patient sees the summary text on their visit page, labelled as AI-assisted and
              reviewed by you.
            </span>
          </span>
        </label>
      </Modal>

      <ReasonDialog
        open={rejectOpen}
        title="Reject the AI draft?"
        label="Why are you rejecting it?"
        confirmLabel="Reject draft"
        tone="danger"
        minLength={REJECTION_REASON_MIN}
        loading={rejecting.isLoading}
        onSubmit={(reason) => void onReject(reason)}
        onCancel={() => setRejectOpen(false)}
      >
        <p className="text-sm text-muted">
          The reason helps the clinic improve the AI instructions. It never contains patient data
          unless you type it.
        </p>
      </ReasonDialog>
    </div>
  );
}
