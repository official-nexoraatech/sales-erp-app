import type { RefObject } from 'react';
import { SearchInput } from '@erp/ui';

interface Props {
  barcodeRef: RefObject<HTMLInputElement | null>;
  videoRef: RefObject<HTMLVideoElement | null>;
  scanFlash: 'success' | 'error' | null;
  cameraOpen: boolean;
  onToggleCamera: () => void;
  onSubmit: (value: string) => void;
}

const FLASH_CLASSES: Record<'success' | 'error' | 'idle', string> = {
  success:
    'border-success shadow-[0_0_0_4px_color-mix(in_srgb,var(--color-success)_20%,transparent)] bg-success-bg',
  error:
    'border-danger shadow-[0_0_0_4px_color-mix(in_srgb,var(--color-danger)_20%,transparent)] bg-danger-bg',
  idle: '',
};

export function POSSearch({
  barcodeRef,
  videoRef,
  scanFlash,
  cameraOpen,
  onToggleCamera,
  onSubmit,
}: Props) {
  return (
    <div className="flex flex-col gap-3">
      <SearchInput
        ref={barcodeRef}
        size="xl"
        placeholder="Scan barcode or type item name…"
        onBarcodeClick={onToggleCamera}
        barcodeActive={cameraOpen}
        className={FLASH_CLASSES[scanFlash ?? 'idle']}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const target = e.currentTarget;
            if (!target.value) return;
            onSubmit(target.value);
            target.value = '';
          }
        }}
      />

      {cameraOpen && (
        <div className="rounded-xl overflow-hidden border-2 border-focus bg-black">
          <video ref={videoRef} className="w-full max-h-56 object-cover" muted />
        </div>
      )}
    </div>
  );
}
