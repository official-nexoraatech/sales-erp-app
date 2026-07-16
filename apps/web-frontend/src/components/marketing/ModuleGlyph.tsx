import type { ComponentType } from 'react';

export type ModuleGlyphVariant = 'default' | 'ink' | 'accent';
export type ModuleGlyphSize = 'sm' | 'md' | 'lg';

interface Props {
  icon: ComponentType<{ className?: string }>;
  variant?: ModuleGlyphVariant;
  size?: ModuleGlyphSize;
  className?: string;
}

const SIZE_MAP: Record<ModuleGlyphSize, { box: string; icon: string; corner: string }> = {
  sm: { box: 'w-9 h-9 rounded-lg', icon: 'h-4 w-4', corner: 'w-1.5 h-1.5' },
  md: { box: 'w-11 h-11 rounded-xl', icon: 'h-5 w-5', corner: 'w-2 h-2' },
  lg: { box: 'w-14 h-14 rounded-2xl', icon: 'h-6 w-6', corner: 'w-2.5 h-2.5' },
};

const VARIANT_MAP: Record<ModuleGlyphVariant, { box: string; icon: string; corner: string }> = {
  default: {
    box: 'bg-[image:linear-gradient(135deg,var(--surface-card),var(--brand-primary-subtle))] border border-default text-brand',
    icon: '',
    corner: 'bg-brand',
  },
  ink: {
    box: 'bg-white/10 border border-marketing-ink text-marketing-ink backdrop-blur-sm',
    icon: '',
    corner: 'bg-accent',
  },
  accent: {
    box: 'bg-[image:linear-gradient(135deg,var(--brand-accent-subtle),var(--surface-card))] border border-accent text-accent',
    icon: '',
    corner: 'bg-accent',
  },
};

/** The brand's one recurring module-icon motif: a lucide icon inside a soft diagonal-gradient
 * badge with a small accent corner mark, in one of three surface contexts (light card, dark
 * "ink" hero surface, or accent-emphasis). Every module/feature icon on the marketing site goes
 * through this component instead of each section hand-rolling its own icon-in-a-box div. */
export default function ModuleGlyph({
  icon: Icon,
  variant = 'default',
  size = 'md',
  className = '',
}: Props) {
  const s = SIZE_MAP[size];
  const v = VARIANT_MAP[variant];
  return (
    <span
      className={`relative inline-flex items-center justify-center shrink-0 ${s.box} ${v.box} ${className}`}
    >
      <Icon className={s.icon} />
      <span
        className={`absolute -top-1 -right-1 ${s.corner} ${v.corner} rounded-full ring-2 ring-[var(--surface-page)]`}
        aria-hidden="true"
      />
    </span>
  );
}
