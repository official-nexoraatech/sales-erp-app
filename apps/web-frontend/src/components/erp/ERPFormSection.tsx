import { type ReactNode } from 'react';

interface Props {
  title: string;
  description?: string;
  children: ReactNode;
  columns?: 1 | 2 | 3 | 4;
  className?: string;
}

export default function ERPFormSection({
  title,
  description,
  children,
  columns = 2,
  className = '',
}: Props) {
  const colClass = {
    1: 'grid-cols-1',
    2: 'grid-cols-1 sm:grid-cols-2',
    3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
    4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
  }[columns];

  return (
    <section className={`bg-surface-card border border-default rounded-xl overflow-hidden ${className}`}>
      <div className="px-6 py-4 border-b border-default">
        <h2 className="text-sm font-semibold text-primary">{title}</h2>
        {description && <p className="text-xs text-secondary mt-0.5">{description}</p>}
      </div>
      <div className={`p-6 grid gap-4 ${colClass}`}>
        {children}
      </div>
    </section>
  );
}
