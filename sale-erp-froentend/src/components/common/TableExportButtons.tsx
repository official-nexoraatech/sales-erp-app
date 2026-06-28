import React, { useState } from 'react';
import { Check, Copy, FileSpreadsheet, FileText, Printer, RefreshCw } from 'lucide-react';

interface TableExportButtonsProps {
  onCopy: () => Promise<void> | void;
  onDownloadExcel: () => void;
  onDownloadCsv: () => void;
  onPrint: () => void;
  onRefresh?: () => void;
  leadingButton?: React.ReactNode;
}

const btnBase = [
  'inline-flex h-9 items-center gap-1.5 border-y border-r px-3 text-xs font-medium select-none',
  'transition-colors duration-100 active:scale-[0.97]',
  'text-slate-600 hover:bg-slate-50 active:bg-slate-100',
  'dark:text-slate-300 dark:hover:bg-slate-700 dark:active:bg-slate-600',
  'border-slate-200 dark:border-slate-700',
].join(' ');

export const TableExportButtons: React.FC<TableExportButtonsProps> = ({
  onCopy,
  onDownloadExcel,
  onDownloadCsv,
  onPrint,
  onRefresh,
  leadingButton,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await onCopy();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const hasLeading = Boolean(leadingButton);

  return (
    <div className="inline-flex flex-wrap items-center rounded-lg overflow-hidden">
      {leadingButton}
      <button
        type="button"
        onClick={handleCopy}
        className={[
          btnBase,
          !hasLeading ? 'rounded-l-lg border-l' : '',
          copied
            ? '!border-green-300 !bg-green-50 !text-green-700 dark:!border-green-800 dark:!bg-green-900/30 dark:!text-green-400'
            : '',
        ]
          .filter(Boolean)
          .join(' ')}
        title="Copy to clipboard"
      >
        {copied ? (
          <><Check size={12} /> Copied!</>
        ) : (
          <><Copy size={12} /> Copy</>
        )}
      </button>
      <button type="button" onClick={onDownloadExcel} className={btnBase} title="Download as Excel">
        <FileSpreadsheet size={12} /> Excel
      </button>
      <button type="button" onClick={onDownloadCsv} className={btnBase} title="Download as CSV">
        <FileText size={12} /> CSV
      </button>
      <button
        type="button"
        onClick={onPrint}
        className={[btnBase, !onRefresh ? 'rounded-r-lg' : ''].filter(Boolean).join(' ')}
        title="Print / PDF"
      >
        <Printer size={12} /> PDF
      </button>
      {onRefresh && (
        <button
          type="button"
          onClick={onRefresh}
          className={`${btnBase} rounded-r-lg`}
          title="Refresh data"
          aria-label="Refresh"
        >
          <RefreshCw size={13} />
        </button>
      )}
    </div>
  );
};
