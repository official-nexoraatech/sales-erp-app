import { useId, useRef, useState, type DragEvent } from 'react';
import {
  Upload,
  X,
  RotateCcw,
  FileText,
  Image as ImageIcon,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Download,
} from 'lucide-react';
import { cn } from './cn.js';

export interface UploadFileItem {
  id: string;
  name: string;
  size: number;
  /** 0-100; omit for an indeterminate "uploading…" state (e.g. no byte-level progress
   * available from the underlying API client). */
  progress?: number;
  status: 'pending' | 'uploading' | 'done' | 'error';
  error?: string | undefined;
  /** Preview thumbnail URL (object URL or server URL) — shown for image files only. */
  previewUrl?: string;
}

export interface FileUploadProps {
  files: UploadFileItem[];
  /** Called with newly picked/dropped files (drag-drop or browse) — the caller owns
   * validation feedback beyond accept/maxSizeBytes and the actual upload transport. */
  onFilesSelected: (files: File[]) => void;
  onRemove: (id: string) => void;
  onRetry?: (id: string) => void;
  /** Shows a download action per file (e.g. for previously-uploaded server records). */
  onDownload?: (id: string) => void;
  accept?: string;
  maxSizeBytes?: number;
  multiple?: boolean;
  disabled?: boolean;
  label?: string;
  hint?: string;
  error?: string;
  wrapperClassName?: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImage(name: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg)$/i.test(name);
}

/** Drag-and-drop + browse file upload — validates accept/size client-side, then hands the
 * File objects to the caller (which owns the actual upload request and drives `files`'
 * status/progress back in, since every consumer here already has its own API + mutation). */
export default function FileUpload({
  files,
  onFilesSelected,
  onRemove,
  onRetry,
  onDownload,
  accept,
  maxSizeBytes,
  multiple = true,
  disabled,
  label,
  hint,
  error,
  wrapperClassName = '',
}: FileUploadProps) {
  const uid = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [localError, setLocalError] = useState<string | undefined>(undefined);

  function validateAndEmit(fileList: FileList | File[]) {
    const incoming = Array.from(fileList);
    if (incoming.length === 0) return;
    const oversized = maxSizeBytes ? incoming.filter((f) => f.size > maxSizeBytes) : [];
    if (oversized.length > 0) {
      setLocalError(
        `${oversized.length === 1 ? oversized[0]!.name : `${oversized.length} files`} exceed${oversized.length === 1 ? 's' : ''} the ${formatSize(maxSizeBytes!)} size limit`
      );
      return;
    }
    setLocalError(undefined);
    onFilesSelected(multiple ? incoming : incoming.slice(0, 1));
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    if (disabled) return;
    validateAndEmit(e.dataTransfer.files);
  }

  const message = error ?? localError ?? hint;
  const isErrorMessage = Boolean(error ?? localError);

  return (
    <div className={cn('flex flex-col gap-1.5', wrapperClassName)}>
      {label && (
        <label className="text-sm font-medium text-primary tracking-[-0.01em]">{label}</label>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={cn(
          'flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed px-6 py-8 text-center transition-colors duration-150 ease-out',
          disabled
            ? 'cursor-not-allowed border-default bg-surface-subtle opacity-50'
            : isDragging
              ? 'border-focus bg-primary-subtle'
              : isErrorMessage
                ? 'border-error bg-danger-bg'
                : 'border-default bg-surface-subtle hover:border-strong'
        )}
      >
        <Upload size={22} className="text-secondary" aria-hidden="true" />
        <p className="text-sm text-primary">
          <button
            type="button"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
            className="font-medium text-link hover:underline disabled:cursor-not-allowed"
          >
            Click to browse
          </button>{' '}
          or drag and drop
        </p>
        {accept && <p className="text-xs text-secondary">{accept.split(',').join(', ')}</p>}
        <input
          ref={inputRef}
          id={uid}
          type="file"
          accept={accept}
          multiple={multiple}
          disabled={disabled}
          className="hidden"
          onChange={(e) => {
            if (e.target.files) validateAndEmit(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {message && (
        <p
          role={isErrorMessage ? 'alert' : undefined}
          className={cn('text-xs', isErrorMessage ? 'text-danger' : 'text-secondary')}
        >
          {message}
        </p>
      )}

      {files.length > 0 && (
        <ul className="flex flex-col gap-2">
          {files.map((f) => (
            <li
              key={f.id}
              className="flex items-center gap-3 rounded-md border border-default bg-surface-card px-3 py-2"
            >
              {f.previewUrl && isImage(f.name) ? (
                <img src={f.previewUrl} alt="" className="h-9 w-9 shrink-0 rounded object-cover" />
              ) : (
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-surface-subtle text-secondary">
                  {isImage(f.name) ? <ImageIcon size={16} /> : <FileText size={16} />}
                </span>
              )}

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-primary">{f.name}</p>
                <p className="text-xs text-secondary">
                  {formatSize(f.size)}
                  {f.status === 'error' && f.error ? ` · ${f.error}` : null}
                </p>
                {f.status === 'uploading' && (
                  <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-surface-subtle">
                    <div
                      className={cn(
                        'h-full rounded-full bg-brand transition-[width] duration-150 ease-out',
                        f.progress === undefined && 'w-1/3 animate-pulse'
                      )}
                      style={f.progress !== undefined ? { width: `${f.progress}%` } : undefined}
                    />
                  </div>
                )}
              </div>

              <span className="shrink-0 text-secondary">
                {f.status === 'uploading' && (
                  <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                )}
                {f.status === 'done' && (
                  <CheckCircle2 size={16} className="text-success" aria-hidden="true" />
                )}
                {f.status === 'error' && (
                  <AlertCircle size={16} className="text-danger" aria-hidden="true" />
                )}
              </span>

              <div className="flex shrink-0 items-center gap-1">
                {f.status === 'done' && onDownload && (
                  <button
                    type="button"
                    title="Download"
                    aria-label={`Download ${f.name}`}
                    onClick={() => onDownload(f.id)}
                    className="rounded-md p-1.5 text-secondary transition-colors hover:bg-surface-raised hover:text-primary"
                  >
                    <Download size={14} />
                  </button>
                )}
                {f.status === 'error' && onRetry && (
                  <button
                    type="button"
                    title="Retry"
                    aria-label={`Retry ${f.name}`}
                    onClick={() => onRetry(f.id)}
                    className="rounded-md p-1.5 text-secondary transition-colors hover:bg-surface-raised hover:text-primary"
                  >
                    <RotateCcw size={14} />
                  </button>
                )}
                <button
                  type="button"
                  title="Remove"
                  aria-label={`Remove ${f.name}`}
                  onClick={() => onRemove(f.id)}
                  className="rounded-md p-1.5 text-secondary transition-colors hover:bg-danger-bg hover:text-danger"
                >
                  <X size={14} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
