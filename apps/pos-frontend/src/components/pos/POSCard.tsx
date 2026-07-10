import type { HTMLAttributes } from 'react';

interface Props extends HTMLAttributes<HTMLDivElement> {
  padding?: 'none' | 'sm' | 'md' | 'lg';
  interactive?: boolean;
}

const PADDING: Record<NonNullable<Props['padding']>, string> = {
  none: '',
  sm: 'p-2',
  md: 'p-3',
  lg: 'p-4',
};

export default function POSCard({
  padding = 'md',
  interactive = false,
  className = '',
  children,
  ...rest
}: Props) {
  return (
    <div
      {...rest}
      className={`bg-surface-card border border-default rounded-xl shadow-token-sm ${PADDING[padding]} ${
        interactive ? 'transition-colors hover:border-strong cursor-pointer active:scale-[0.98]' : ''
      } ${className}`}
    >
      {children}
    </div>
  );
}
