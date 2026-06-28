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

const btnBase =
  'h-10 border-y border-r px-3 text-sm transition-all duration-100 active:scale-95 active:bg-gray-100 hover:bg-gray-50 dark:hover:bg-slate-700 dark:active:bg-slate-600 dark:border-slate-600 dark:text-slate-200 select-none';

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

  const hasLeading = !!leadingButton;

  return (
    <div className="flex flex-wrap items-center">
      {leadingButton}
      <button
        type="button"
        onClick={handleCopy}
        className={`${btnBase} border-l ${hasLeading ? '' : 'rounded-l'} ${
          copied
            ? 'border-green-300 bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-400'
            : ''
        }`}
        title="Copy to clipboard"
      >
        {copied ? (
          <span className="flex items-center gap-1">
            <Check size={13} />
            Copied!
          </span>
        ) : (
          <span className="flex items-center gap-1">
            <Copy size={13} />
            Copy
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={onDownloadExcel}
        className={`${btnBase}`}
        title="Download as Excel"
      >
        <span className="flex items-center gap-1">
          <FileSpreadsheet size={13} />
          Excel
        </span>
      </button>
      <button
        type="button"
        onClick={onDownloadCsv}
        className={`${btnBase}`}
        title="Download as CSV"
      >
        <span className="flex items-center gap-1">
          <FileText size={13} />
          CSV
        </span>
      </button>
      <button
        type="button"
        onClick={onPrint}
        className={`${btnBase} ${!onRefresh ? 'rounded-r' : ''}`}
        title="Print / PDF"
      >
        <span className="flex items-center gap-1">
          <Printer size={13} />
          PDF
        </span>
      </button>
      {onRefresh && (
        <button
          type="button"
          onClick={onRefresh}
          className={`${btnBase} rounded-r`}
          title="Refresh"
        >
          <RefreshCw size={15} />
        </button>
      )}
    </div>
  );
};
