import { FileUp, X } from 'lucide-react';
import { useId, useRef, useState, type DragEvent } from 'react';
import { UPLOAD_RULES } from '../../constants/catalog';
import { checkUploadFile, formatFileSize } from '../../utils/files';

/**
 * File picker with drag-and-drop (spec §12.2): one file, checked on choice (type and size), its
 * name and size with a remove button, and an upload progress bar. `error` shows the server's
 * message (e.g. 415 for a file that is not what its name says).
 */
export default function FileUpload({
  label,
  file,
  onChange,
  progress,
  error,
  disabled = false,
}: {
  label: string;
  file: File | null;
  onChange: (file: File | null) => void;
  /** 0…1 while uploading, null otherwise. */
  progress: number | null;
  error?: string | null;
  disabled?: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const message = localError ?? error ?? null;

  const choose = (chosen: File | undefined | null) => {
    if (!chosen) return;
    const problem = checkUploadFile(chosen);
    setLocalError(problem);
    onChange(problem ? null : chosen);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (!disabled) choose(e.dataTransfer.files?.[0]);
  };

  return (
    <div>
      <span id={`${id}-label`} className="mb-1.5 block text-sm font-semibold text-ink">
        {label}
      </span>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`rounded-card border-2 border-dashed p-4 text-center transition-colors duration-150 ease-standard motion-safe:transition-colors ${
          dragging
            ? 'border-primary-400 bg-primary-50'
            : message
              ? 'border-danger-500'
              : 'border-line'
        }`}
      >
        <FileUp className="mx-auto h-6 w-6 text-muted" aria-hidden="true" />
        <p className="mt-1 text-sm text-ink">
          Drag a file here, or{' '}
          <label
            htmlFor={id}
            className="cursor-pointer font-semibold text-primary-700 underline underline-offset-2"
          >
            choose a file
          </label>
        </p>
        <p className="text-xs text-muted">PDF, JPG or PNG, up to {UPLOAD_RULES.maxMb} MB</p>
        <input
          ref={input}
          id={id}
          type="file"
          className="sr-only"
          accept={UPLOAD_RULES.accept}
          aria-labelledby={`${id}-label`}
          aria-describedby={message ? `${id}-error` : undefined}
          aria-invalid={message ? true : undefined}
          disabled={disabled}
          onChange={(e) => {
            choose(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>
      {file && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-control bg-neutral-50 px-3 py-2 text-sm">
          <span className="min-w-0 truncate text-ink">
            {file.name} <span className="text-muted">({formatFileSize(file.size)})</span>
          </span>
          {progress === null && (
            <button
              type="button"
              onClick={() => onChange(null)}
              aria-label={`Remove ${file.name}`}
              className="rounded-full p-1 text-muted hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-primary-600"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      )}
      {progress !== null && (
        <div
          role="progressbar"
          aria-label="Upload progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          className="mt-2 h-2 overflow-hidden rounded-full bg-neutral-100"
        >
          <div
            className="h-full bg-primary-600 motion-safe:transition-[width] motion-safe:duration-200"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
      )}
      {message && (
        <p id={`${id}-error`} role="alert" className="mt-1.5 text-sm font-semibold text-danger-700">
          {message}
        </p>
      )}
    </div>
  );
}
