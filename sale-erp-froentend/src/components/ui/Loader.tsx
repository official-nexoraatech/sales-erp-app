import React from 'react';

interface LoaderProps {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  label?: string;
  fullPage?: boolean;
  overlay?: boolean;
}

const sizeMap = {
  xs: 'h-3 w-3 border-2',
  sm: 'h-5 w-5 border-2',
  md: 'h-8 w-8 border-[3px]',
  lg: 'h-12 w-12 border-4',
  xl: 'h-16 w-16 border-4',
};

const Spinner: React.FC<{ size: string }> = ({ size }) => (
  <div
    className={`${size} animate-spin rounded-full border-blue-200 border-t-blue-600 dark:border-blue-800 dark:border-t-blue-400`}
    role="status"
    aria-hidden="true"
  />
);

export const Loader: React.FC<LoaderProps> = ({
  size = 'md',
  label,
  fullPage = false,
  overlay = false,
}) => {
  const content = (
    <div className="flex flex-col items-center justify-center gap-3">
      <Spinner size={sizeMap[size]} />
      {label && (
        <span className="text-sm font-medium text-slate-500 dark:text-slate-400">{label}</span>
      )}
    </div>
  );

  if (overlay) {
    return (
      <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-white/70 dark:bg-slate-900/70 backdrop-blur-[1px]">
        {content}
      </div>
    );
  }

  if (fullPage) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-slate-50 dark:bg-slate-900">
        {content}
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center py-8">
      {content}
    </div>
  );
};
