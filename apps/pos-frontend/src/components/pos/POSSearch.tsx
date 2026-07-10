import type { RefObject } from 'react';
import { Camera } from 'lucide-react';

interface Props {
  barcodeRef: RefObject<HTMLInputElement | null>;
  videoRef: RefObject<HTMLVideoElement | null>;
  scanFlash: 'success' | 'error' | null;
  cameraOpen: boolean;
  onToggleCamera: () => void;
  onSubmit: (value: string) => void;
}

const FLASH_CLASSES: Record<'success' | 'error' | 'idle', string> = {
  success: 'border-success ring-4 ring-[var(--color-success)]/20 bg-success-bg',
  error: 'border-danger ring-4 ring-[var(--color-danger)]/20 bg-danger-bg',
  idle: 'border-default focus-within:border-focus',
};

export function POSSearch({ barcodeRef, videoRef, scanFlash, cameraOpen, onToggleCamera, onSubmit }: Props) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <input
          ref={barcodeRef}
          type="text"
          placeholder="Scan barcode or type item name…"
          className={`flex-1 min-h-[52px] rounded-xl border-2 bg-surface-card px-4 text-lg text-primary placeholder:text-placeholder transition-colors focus:outline-none ${FLASH_CLASSES[scanFlash ?? 'idle']}`}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const target = e.currentTarget;
              if (!target.value) return;
              onSubmit(target.value);
              target.value = '';
            }
          }}
        />
        <button
          onClick={onToggleCamera}
          title="Scan with camera"
          aria-label="Scan with camera"
          aria-pressed={cameraOpen}
          className={`flex items-center justify-center min-w-[52px] rounded-xl border-2 font-semibold transition-colors ${
            cameraOpen ? 'border-focus bg-primary-subtle text-brand' : 'border-default text-secondary hover:border-strong'
          }`}
        >
          <Camera size={22} />
        </button>
      </div>

      {cameraOpen && (
        <div className="rounded-xl overflow-hidden border-2 border-focus bg-black">
          <video ref={videoRef} className="w-full max-h-56 object-cover" muted />
        </div>
      )}
    </div>
  );
}
