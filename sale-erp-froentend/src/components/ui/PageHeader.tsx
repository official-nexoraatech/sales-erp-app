import React from 'react';

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  description,
  actions,
}) => {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">
        <h1 className="break-words text-2xl font-bold text-gray-900 sm:text-3xl">{title}</h1>
        {description && (
          <p className="text-gray-600 text-sm mt-1">{description}</p>
        )}
      </div>
      {actions && <div className="flex w-full flex-wrap gap-3 sm:w-auto sm:justify-end">{actions}</div>}
    </div>
  );
};
