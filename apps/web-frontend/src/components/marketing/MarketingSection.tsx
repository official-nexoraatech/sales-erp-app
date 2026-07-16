import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
  surface?: 'light' | 'card' | 'ink';
  glow?: boolean;
  id?: string;
  className?: string;
  containerClassName?: string;
}

const SURFACE_CLASS: Record<NonNullable<Props['surface']>, string> = {
  light: 'bg-surface-page',
  card: 'bg-surface-card border-y border-default',
  ink: 'bg-marketing-ink text-marketing-ink',
};

/** Shared section shell for the marketing site — replaces the 3 hand-copied literal
 * linear-gradient(135deg, var(--brand-primary)...) strings that made Hero and CTASection
 * look like the same component. `surface="ink"` gives the one dark "brand moment" (used by
 * Hero + the final CTA, deliberately with different content/decoration so they don't read as
 * identical), everything else stays on the app's normal light surfaces. */
export default function MarketingSection({
  children,
  surface = 'light',
  glow = false,
  id,
  className = '',
  containerClassName = '',
}: Props) {
  return (
    <section id={id} className={`relative overflow-hidden ${SURFACE_CLASS[surface]} ${className}`}>
      {surface === 'ink' && <div className="absolute inset-0 bg-gradient-ink" aria-hidden="true" />}
      {glow && (
        <div
          className="absolute inset-0 bg-gradient-accent-glow motion-safe:animate-pulse [animation-duration:6s]"
          aria-hidden="true"
        />
      )}
      <div className={`relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 ${containerClassName}`}>
        {children}
      </div>
    </section>
  );
}
