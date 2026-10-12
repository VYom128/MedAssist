import { skipToken } from '@reduxjs/toolkit/query';
import { Phone, RotateCw, Sparkles, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppDispatch } from '../../../app/hooks';
import Alert from '../../../components/ui/Alert';
import Button from '../../../components/ui/Button';
import { buttonClass } from '../../../components/ui/buttonClass';
import FilterChip from '../../../components/ui/FilterChip';
import { linkClass } from '../../../components/ui/linkClass';
import Skeleton from '../../../components/ui/Skeleton';
import Textarea from '../../../components/ui/Textarea';
import type { ExplanationLanguage } from '../../../constants/catalog';
import { getQueryErrorMessage, isApiQueryError } from '../../../utils/http';
import { formatPhone } from '../../../utils/phone';
import { useGetMyPatientQuery } from '../../patients/api';
import { settingsApi } from '../../settings/api';
import {
  useExplainQuery,
  useExplanationFeedbackMutation,
  type Explanation,
  type ExplanationSource,
} from '../api';
import { aiError } from '../errors';
import { EXPLANATION_HEADINGS, LANGUAGE_NATIVE } from '../explanationText';
import { flagText } from '../flags';
import { aiConsentRefused } from '../format';
import { useAiFlags } from '../useAiFlags';

/** Server AI_RULES.feedbackCommentMax. */
const COMMENT_MAX = 500;

function ContactClinic({ phone }: { phone: string | null }) {
  if (!phone) return null;
  return (
    <a href={`tel:${phone}`} className={buttonClass('secondary', 'sm')}>
      <Phone className="h-4 w-4" aria-hidden="true" /> Contact the clinic ({formatPhone(phone)})
    </a>
  );
}

function List({ items }: { items: string[] }) {
  return (
    <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-body">
      {items.map((t, i) => (
        <li key={i}>{t}</li>
      ))}
    </ul>
  );
}

/** 👍 / 👎 with an optional comment, on the patient's cached prescription explanation. */
function Feedback({
  prescriptionId,
  explanation,
}: {
  prescriptionId: string;
  explanation: Explanation;
}) {
  const [send, sending] = useExplanationFeedbackMutation();
  const [helpful, setHelpful] = useState<boolean | null>(null);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (explanation.feedback) {
    return <p className="text-sm text-muted">Thank you for your feedback.</p>;
  }
  const submit = async (value: boolean, text?: string) => {
    setError(null);
    try {
      await send({
        prescriptionId,
        language: explanation.language,
        helpful: value,
        ...(text?.trim() ? { comment: text.trim() } : {}),
      }).unwrap();
    } catch (err) {
      setError(getQueryErrorMessage(err));
    }
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-ink">Was this helpful?</span>
        <Button
          variant={helpful === true ? 'soft' : 'secondary'}
          size="sm"
          aria-pressed={helpful === true}
          onClick={() => setHelpful(true)}
        >
          <ThumbsUp className="h-4 w-4" aria-hidden="true" /> Yes
        </Button>
        <Button
          variant={helpful === false ? 'soft' : 'secondary'}
          size="sm"
          aria-pressed={helpful === false}
          onClick={() => setHelpful(false)}
        >
          <ThumbsDown className="h-4 w-4" aria-hidden="true" /> No
        </Button>
      </div>
      {helpful !== null && (
        <div className="space-y-2">
          <Textarea
            label="Anything to add? (optional)"
            hint={`${comment.length}/${COMMENT_MAX}`}
            value={comment}
            maxLength={COMMENT_MAX}
            rows={2}
            onChange={(e) => setComment(e.target.value)}
          />
          <Button
            size="sm"
            onClick={() => void submit(helpful, comment)}
            loading={sending.isLoading}
          >
            Send feedback
          </Button>
        </div>
      )}
      {error && <p className="text-sm text-danger-700">{error}</p>}
    </div>
  );
}

/** The explanation itself; the disclaimer always closes it and cannot be hidden. */
function ExplanationBody({
  explanation: x,
  forDoctor,
  feedbackFor,
  clinicPhone,
}: {
  explanation: Explanation;
  forDoctor: boolean;
  feedbackFor: string | null;
  clinicPhone: string | null;
}) {
  const h = EXPLANATION_HEADINGS[x.language];
  const c = x.content;
  return (
    <div className="space-y-5">
      <div lang={x.language} className="space-y-5">
        <div>
          <p className="text-xs text-muted">{x.label}</p>
          {x.isFallback && (
            <p lang="en" className="mt-1 text-xs font-semibold text-muted">
              Shown in a simplified format.
            </p>
          )}
          {c.overview && <p className="mt-2 text-sm whitespace-pre-line text-body">{c.overview}</p>}
        </div>

        {c.medicines.length > 0 && (
          <section>
            <h4 className="text-card text-ink">{h.medicines}</h4>
            <ul className="mt-2 grid gap-3 sm:grid-cols-2">
              {c.medicines.map((m, i) => (
                <li key={i} className="rounded-control border border-line bg-surface p-4">
                  <p className="font-semibold text-ink">{m.name}</p>
                  <dl className="mt-2 space-y-1.5 text-sm">
                    {(
                      [
                        [h.whatToDo, m.whatToDo],
                        [h.whenToTake, m.whenToTake],
                        [h.howLong, m.howLong],
                      ] as const
                    )
                      .filter(([, v]) => v)
                      .map(([label, value]) => (
                        <div key={label}>
                          <dt className="text-xs font-semibold text-muted">{label}</dt>
                          <dd className="text-body">{value}</dd>
                        </div>
                      ))}
                  </dl>
                  {m.tips.length > 0 && (
                    <div className="mt-2">
                      <p className="text-xs font-semibold text-muted">{h.tips}</p>
                      <List items={m.tips} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {c.followUp && (
          <section>
            <h4 className="text-card text-ink">{h.followUp}</h4>
            <p className="mt-1 text-sm whitespace-pre-line text-body">{c.followUp}</p>
          </section>
        )}

        <section className="rounded-control border border-warning-100 bg-warning-50 p-4">
          <h4 className="text-card text-warning-700">{h.contact}</h4>
          <List items={c.whenToContactClinic} />
          <div lang="en" className="mt-3">
            <ContactClinic phone={clinicPhone} />
          </div>
        </section>

        {c.questionsToAskDoctor.length > 0 && (
          <section>
            <h4 className="text-card text-ink">{h.questions}</h4>
            <List items={c.questionsToAskDoctor} />
          </section>
        )}
      </div>

      {forDoctor && (x.guardrailFlags?.length ?? 0) > 0 && (
        <Alert tone="info" title="Safety checks on this explanation">
          <ul className="list-disc space-y-0.5 pl-5">
            {x.guardrailFlags!.map((f) => (
              <li key={f}>{flagText(f)}</li>
            ))}
          </ul>
        </Alert>
      )}

      {feedbackFor && <Feedback prescriptionId={feedbackFor} explanation={x} />}

      <p
        lang={x.language}
        data-testid="explanation-disclaimer"
        className="rounded-control border border-line bg-surface-muted p-3 text-xs text-muted"
      >
        {x.disclaimer}
      </p>
    </div>
  );
}

/**
 * "Explain in simple words" (spec §4.12, §9.3): an AI explanation of the patient's prescription
 * or follow-up plan with a language switch. Patients see it only with AI explanations on and
 * their AI consent not withdrawn (then a note links to the setting instead); doctors get a
 * labelled preview of what the patient will see.
 */
export default function ExplanationPanel({
  source,
  audience,
}: {
  source: ExplanationSource;
  audience: 'patient' | 'doctor';
}) {
  const forDoctor = audience === 'doctor';
  const dispatch = useAppDispatch();
  const flags = useAiFlags();
  const me = useGetMyPatientQuery(forDoctor || !flags.patientExplanation ? skipToken : undefined);
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<ExplanationLanguage | null>(null);
  const preferred = me.data?.preferredLanguage;
  const language: ExplanationLanguage =
    chosen ??
    (preferred && flags.languages.includes(preferred) ? preferred : (flags.languages[0] ?? 'en'));
  const result = useExplainQuery(open ? { source, language } : skipToken);
  const error = result.isError ? aiError(result.error) : null;
  const consentOff =
    error?.kind === 'disabled' &&
    isApiQueryError(result.error) &&
    (result.error.details as { reason?: string } | undefined)?.reason === 'consent';
  const clinicTurnedOff = error?.kind === 'disabled' && !consentOff;
  useEffect(() => {
    // Turned off meanwhile: refresh the switches (the button then disappears).
    if (clinicTurnedOff) {
      dispatch(settingsApi.util.invalidateTags([{ type: 'Settings', id: 'PUBLIC' }]));
    }
  }, [clinicTurnedOff, dispatch]);

  if (!flags.patientExplanation) return null;
  if (!forDoctor) {
    if (me.isLoading) return null;
    if (aiConsentRefused(me.data?.consent.aiExplanations)) {
      return (
        <p className="text-sm text-muted">
          AI explanations are turned off for you.{' '}
          <Link to="/patient/profile#consent" className={linkClass}>
            Turn them on in My details
          </Link>{' '}
          to get your doctor’s instructions explained in simple words.
        </p>
      );
    }
  }

  const buttonLabel = forDoctor ? 'Preview explanation' : 'Explain in simple words';
  if (!open) {
    return (
      <Button variant="soft" onClick={() => setOpen(true)}>
        <Sparkles className="h-4 w-4" aria-hidden="true" /> {buttonLabel}
      </Button>
    );
  }

  return (
    <section
      aria-label={forDoctor ? 'Preview – what the patient will see' : 'Explained in simple words'}
      className="space-y-4 rounded-card border border-consult-100 bg-consult-50 p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-1.5 text-card text-ink">
          <Sparkles className="h-4 w-4 text-consult-700" aria-hidden="true" />
          {forDoctor ? 'Preview – what the patient will see' : 'In simple words'}
        </h3>
        {flags.languages.length > 1 && (
          <div role="group" aria-label="Language" className="flex flex-wrap gap-2">
            {flags.languages.map((l) => (
              <FilterChip
                key={l}
                lang={l}
                label={LANGUAGE_NATIVE[l]}
                selected={l === language}
                onClick={() => setChosen(l)}
              />
            ))}
          </div>
        )}
      </div>

      {result.isFetching && (
        <div role="status" className="space-y-3">
          <p className="text-sm text-muted">
            Writing a simple explanation… This can take up to 30 seconds.
          </p>
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {!result.isFetching && error && (
        <div className="space-y-3">
          {consentOff ? (
            <Alert tone="info" title="AI explanations are turned off">
              {forDoctor
                ? 'The patient has turned off AI explanations.'
                : 'You turned off AI explanations in My details.'}
            </Alert>
          ) : error.kind === 'disabled' ? (
            <Alert tone="info" title="AI explanations are turned off by the clinic" />
          ) : (
            <Alert
              tone={error.kind === 'other' ? 'error' : 'warning'}
              title={
                error.kind === 'daily_limit'
                  ? 'Daily AI limit reached – explanations are available again tomorrow.'
                  : error.message
              }
            >
              {!forDoctor &&
                'Your doctor’s instructions above still apply. You can ask the clinic.'}
            </Alert>
          )}
          <div className="flex flex-wrap gap-2">
            {error.retry && error.kind !== 'disabled' && (
              <Button variant="secondary" size="sm" onClick={() => void result.refetch()}>
                <RotateCw className="h-4 w-4" aria-hidden="true" /> Try again
              </Button>
            )}
            {!forDoctor && <ContactClinic phone={flags.clinicPhone} />}
          </div>
        </div>
      )}

      {!result.isFetching && result.data && (
        <ExplanationBody
          explanation={result.data}
          forDoctor={forDoctor}
          feedbackFor={!forDoctor && source.kind === 'prescription' ? source.id : null}
          clinicPhone={flags.clinicPhone}
        />
      )}
    </section>
  );
}
