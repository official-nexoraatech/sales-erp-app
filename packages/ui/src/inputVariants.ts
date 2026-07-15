import { cva, type VariantProps } from 'class-variance-authority';

/**
 * Shared recipe for every input-family control (Input, Textarea, Select trigger,
 * Combobox trigger). One radius (rounded-xl → --radius-xl), one size scale, one
 * focus treatment — see packages/design-tokens/tokens.css for the underlying
 * --input-height-* / --shadow-focus-* tokens this reads.
 */
export const inputVariants = cva(
  [
    // rounded-md (--radius-md, 6px) — enterprise forms use a subtle corner, not the
    // rounded-xl/12px pill-ish radius the rest of the app's cards/buttons use.
    'w-full min-w-0 rounded-md text-primary',
    'border',
    'transition-[color,background-color,border-color,box-shadow] duration-150 ease-out',
    'outline-none',
    'placeholder:text-placeholder placeholder:font-normal',
    'disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-surface-subtle disabled:text-disabled',
    // readOnly must read as distinctly non-editable without looking disabled (still
    // selectable/copyable, just not editable) — a muted background is the differentiator.
    'read-only:bg-surface-subtle read-only:cursor-default',
  ],
  {
    variants: {
      size: {
        sm: 'h-[var(--input-height-sm)] px-3 text-sm gap-1.5',
        md: 'h-[var(--input-height-md)] px-3.5 text-base gap-2',
        lg: 'h-[var(--input-height-lg)] px-4 text-base gap-2',
        xl: 'h-[var(--input-height-xl)] px-5 text-lg gap-2.5',
      },
      variant: {
        default: 'bg-surface-card border-default hover:border-strong',
        filled: 'bg-surface-subtle border-transparent hover:bg-surface-raised',
        ghost: 'bg-transparent border-transparent hover:bg-surface-subtle',
        outline: 'bg-transparent border-strong hover:border-[var(--text-disabled)]',
      },
      state: {
        default: 'focus:border-focus focus:shadow-[var(--shadow-focus)]',
        error:
          'border-error bg-danger-bg focus:border-error focus:shadow-[var(--shadow-focus-error)]',
        success: 'border-success focus:border-success focus:shadow-[var(--shadow-focus-success)]',
        warning: 'border-warning focus:border-warning focus:shadow-[var(--shadow-focus-warning)]',
      },
    },
    defaultVariants: {
      size: 'md',
      variant: 'default',
      state: 'default',
    },
  }
);

export type InputVariants = VariantProps<typeof inputVariants>;

/** Icon size in px per input size — keeps left/right icons visually centered and proportional. */
export const ICON_SIZE_BY_INPUT_SIZE: Record<NonNullable<InputVariants['size']>, number> = {
  sm: 14,
  md: 16,
  lg: 18,
  xl: 20,
};
