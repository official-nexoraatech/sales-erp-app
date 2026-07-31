import type { ReactNode } from 'react';
import BrandMark from '../marketing/BrandMark.js';

/** Abstract skyline silhouette + window-grid texture, built from CSS/SVG only (no image
 * asset) so it stays crisp at any size and needs no separate light/dark asset. */
function Skyline() {
  return (
    <svg
      viewBox="0 0 1440 400"
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 w-full opacity-30"
      aria-hidden="true"
    >
      <rect x="40" y="140" width="140" height="260" fill="white" fillOpacity="0.12" />
      <rect x="200" y="60" width="110" height="340" fill="white" fillOpacity="0.18" />
      <rect x="330" y="180" width="90" height="220" fill="white" fillOpacity="0.1" />
      <rect x="460" y="20" width="130" height="380" fill="white" fillOpacity="0.15" />
      <rect x="620" y="120" width="100" height="280" fill="white" fillOpacity="0.12" />
      <rect x="760" y="70" width="150" height="330" fill="white" fillOpacity="0.16" />
      <rect x="940" y="160" width="100" height="240" fill="white" fillOpacity="0.1" />
      <rect x="1070" y="40" width="120" height="360" fill="white" fillOpacity="0.14" />
      <rect x="1220" y="150" width="140" height="250" fill="white" fillOpacity="0.12" />
    </svg>
  );
}

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-[#0f2a63] via-[#1e40af] to-[#153170] p-4">
      <div
        className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(90deg,transparent,transparent_38px,rgba(255,255,255,0.03)_38px,rgba(255,255,255,0.03)_40px)]"
        aria-hidden="true"
      />
      <Skyline />

      <div className="relative w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <BrandMark inverse />
        </div>
        <div className="rounded-2xl bg-surface-card p-8 shadow-2xl">{children}</div>
      </div>
    </div>
  );
}
