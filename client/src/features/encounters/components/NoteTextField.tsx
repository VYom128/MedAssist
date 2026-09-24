import Textarea from '../../../components/ui/Textarea';
import { NOTE_FIELD_LABELS, NOTE_TEXT_LIMITS } from '../../../constants/catalog';
import type { NoteChanges } from '../api';
import { fieldId } from '../fields';

export type TextNoteField =
  | 'chiefComplaint'
  | 'historyOfPresentIllness'
  | 'pastHistory'
  | 'examination'
  | 'assessment'
  | 'plan'
  | 'adviceToPatient';

/** An auto-growing note text field with the server's length limit. Empty = cleared. */
export default function NoteTextField({
  field,
  value,
  onChange,
  onBlur,
  required,
  hint,
}: {
  field: TextNoteField;
  value: string | null;
  onChange: (changes: NoteChanges) => void;
  onBlur?: () => void;
  required?: boolean;
  hint?: string;
}) {
  const max = NOTE_TEXT_LIMITS[field];
  const text = value ?? '';
  return (
    <Textarea
      id={fieldId(field)}
      label={`${NOTE_FIELD_LABELS[field]}${required ? ' (needed to sign)' : ''}`}
      autoGrow
      rows={field === 'chiefComplaint' ? 2 : 3}
      maxLength={max}
      value={text}
      hint={text.length > max * 0.9 ? `${text.length} / ${max} characters` : hint}
      onChange={(e) => onChange({ [field]: e.target.value === '' ? null : e.target.value })}
      onBlur={onBlur}
    />
  );
}
