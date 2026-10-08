import type { NoteChanges } from '../api';

/**
 * "Share diagnosis with patient" (Phase 8): when ticked, the patient's visit summary shows the
 * diagnoses. Off by default; after signing it changes only through an amendment.
 */
export default function ShareDiagnosisField({
  checked,
  onChange,
  onBlur,
}: {
  checked: boolean;
  onChange: (changes: NoteChanges) => void;
  onBlur?: () => void;
}) {
  return (
    <div className="rounded-control border border-line bg-surface-muted p-3">
      <label className="flex min-h-11 items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange({ shareDiagnosisWithPatient: e.target.checked })}
          onBlur={onBlur}
          className="mt-0.5 h-4 w-4 shrink-0 accent-primary-600"
        />
        <span>
          <span className="font-semibold text-ink">Share diagnosis with patient</span>
          <span className="block text-muted">
            The patient sees the diagnoses on their visit summary in the portal. History,
            examination, assessment and plan are never shown to them.
          </span>
        </span>
      </label>
    </div>
  );
}
