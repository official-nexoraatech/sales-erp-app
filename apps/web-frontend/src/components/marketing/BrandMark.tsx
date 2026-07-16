/** Original wordmark glyph: three connected nodes ascending left-to-right — reads as both
 * "growth" and "connected systems" (the two things an ERP is actually for), rendered as a
 * single-color SVG so it works identically on light, dark, ink, and HC surfaces via
 * `currentColor` — no separate light/dark asset needed. Shared by the public marketing
 * pages and AuthLayout (login/signup).
 */
function Glyph({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" aria-hidden="true">
      <path
        d="M8 23L15 14L24 8"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="round"
        opacity="0.45"
      />
      <rect x="4" y="19" width="8" height="8" rx="2.5" fill="currentColor" />
      <rect x="11.5" y="10.5" width="7" height="7" rx="2.25" fill="currentColor" opacity="0.85" />
      <rect x="20" y="4" width="8" height="8" rx="2.5" fill="currentColor" />
    </svg>
  );
}

export default function BrandMark({
  inverse = false,
  className = '',
}: {
  inverse?: boolean;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <Glyph className={`h-8 w-8 shrink-0 ${inverse ? 'text-white' : 'text-brand'}`} />
      <span
        className={`font-display font-semibold tracking-tight text-lg ${inverse ? 'text-white' : 'text-primary'}`}
      >
        NEXORAA
      </span>
    </span>
  );
}
