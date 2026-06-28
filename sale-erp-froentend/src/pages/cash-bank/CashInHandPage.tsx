import React, { useState } from 'react';
import { X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { cashApi } from '../../api/endpoints';
import type { MoneyTransaction } from '../../api/endpoints';
import { Button } from '../../components/ui/Button';
import { Loader } from '../../components/ui/Loader';
import { Pagination } from '../../components/ui/Pagination';
import { useAuth } from '../../hooks/useAuth';
import { usePagination } from '../../hooks/usePagination';
import { formatCurrency } from '../../utils/formatCurrency';
import { formatDate } from '../../utils/formatDate';
import { TableExportButtons } from '../../components/common/TableExportButtons';

const exportColumns = ['Type', 'Date', 'Party Name', 'Amount', 'Note', 'Created by', 'Action'];
const txDate = (tx: MoneyTransaction) => tx.date || tx.transactionDate || '';

export const CashInHandPage: React.FC = () => {
  const { user } = useAuth();
  const { page, setPage, handlePageChange } = usePagination();
  const [pageSize, setPageSize] = useState(10);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [search, setSearch] = useState('');
  const [showAdjust, setShowAdjust] = useState(false);
  const summary = useQuery({ queryKey: ['cash-summary'], queryFn: cashApi.getSummary });
  const transactions = useQuery({ queryKey: ['cash-transactions'], queryFn: cashApi.getTransactions });
  const rows = (transactions.data?.data?.content || []).filter((tx) => !search || JSON.stringify(tx).toLowerCase().includes(search.toLowerCase())).filter((tx) => !fromDate || txDate(tx) >= fromDate).filter((tx) => !toDate || txDate(tx) <= toDate);
  const balance = summary.data?.data?.cashInHand ?? summary.data?.data?.balance ?? 0;
  const exportRows = () => rows.map((tx) => [tx.type, txDate(tx), tx.partyName || '', tx.amount, tx.note || '', tx.createdBy || user?.userName || 'admin', 'NA']);
  const copy = async () => { await navigator.clipboard.writeText([exportColumns, ...exportRows()].map((row) => row.join('\t')).join('\n')); toast.success('Cash transactions copied'); };
  const download = (extension: 'csv' | 'xls') => {
    const separator = extension === 'csv' ? ',' : '\t';
    const content = [exportColumns, ...exportRows()].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(separator)).join('\n');
    const blob = new Blob([content], { type: extension === 'csv' ? 'text/csv' : 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `cash-transactions.${extension}`; link.click(); URL.revokeObjectURL(url);
  };
  const printPdf = () => {
    const popup = window.open('', '_blank'); if (!popup) return;
    popup.document.write(`<html><head><title>Cash In Hand</title></head><body><h2>Cash In Hand</h2><table border="1" cellspacing="0" cellpadding="6"><thead><tr>${exportColumns.map((column) => `<th>${column}</th>`).join('')}</tr></thead><tbody>${exportRows().map((row) => `<tr>${row.map((value) => `<td>${value}</td>`).join('')}</tr>`).join('')}</tbody></table><script>window.print()</script></body></html>`);
    popup.document.close();
  };
  return (
    <div className="space-y-5">
      <div className="text-sm text-gray-500">Home &gt; Cash &amp; Bank &gt; Cash In Hand</div>
      <div className="overflow-hidden rounded-lg bg-white shadow">
        <div className="flex items-center justify-between border-b px-5 py-4"><h1 className="text-xl font-semibold uppercase text-gray-900">Cash In Hand : <span className={balance < 0 ? 'text-red-500' : 'text-green-600'}>{balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></h1></div>
        <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2"><label className="text-sm text-gray-600">From Date<input type="date" className="mt-1 h-10 w-full rounded border border-gray-300 px-3" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label><label className="text-sm text-gray-600">To Date<input type="date" className="mt-1 h-10 w-full rounded border border-gray-300 px-3" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label></div>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-4"><label className="flex items-center gap-2 text-sm text-gray-600">Show<select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(0); }} className="h-9 rounded border border-gray-300 px-2"><option>10</option><option>20</option><option>50</option><option>100</option></select>entries</label><TableExportButtons onCopy={copy} onDownloadExcel={() => download('xls')} onDownloadCsv={() => download('csv')} onPrint={printPdf} /><label className="flex items-center gap-2 text-sm text-gray-600">Search:<input value={search} onChange={(event) => setSearch(event.target.value)} className="h-9 rounded border border-gray-300 px-3" /></label></div>
        <div className="overflow-x-auto px-3 pb-3">{transactions.isLoading ? <div className="p-10"><Loader /></div> : <table className="w-full text-sm"><thead className="bg-gray-50"><tr>{exportColumns.map((heading) => <th key={heading} className="border p-3 text-left">{heading}</th>)}</tr></thead><tbody>{rows.length ? rows.map((tx, index) => <tr key={tx.id || tx.transactionId || index} className="border-b even:bg-gray-50"><td className="border p-3">{tx.type}</td><td className="border p-3">{formatDate(txDate(tx))}</td><td className="border p-3">{tx.partyName || 'N/A'}</td><td className={`border p-3 font-semibold ${tx.type?.toLowerCase().includes('sale') || tx.amount > 0 ? 'text-green-600' : 'text-red-500'}`}>{formatCurrency(tx.amount)}</td><td className="border p-3">{tx.note || ''}</td><td className="border p-3">{tx.createdBy || user?.userName || 'admin'}</td><td className="border p-3">NA</td></tr>) : <tr><td colSpan={7} className="bg-gray-50 p-5 text-center">No data available in table</td></tr>}</tbody></table>}</div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4 text-sm text-gray-600"><span>Showing {rows.length ? page * pageSize + 1 : 0} to {page * pageSize + rows.length} of {transactions.data?.data?.totalElements || 0} entries</span><Pagination page={page} totalPages={transactions.data?.data?.totalPages || 1} onPageChange={handlePageChange} /></div>
      </div>
      {showAdjust && <CashAdjustModal onClose={() => setShowAdjust(false)} />}
    </div>
  );
};

const CashAdjustModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [type, setType] = useState('Add Cash');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  return <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/45 p-8"><div className="w-full max-w-md rounded bg-white shadow-xl"><div className="flex items-center justify-between border-b px-4 py-3"><h2 className="text-lg font-semibold">Cash In Hand</h2><button onClick={onClose}><X size={20} /></button></div><div className="space-y-4 p-4"><label className="block text-sm text-gray-600">Adjustment Type<select className="mt-1 h-10 w-full rounded border px-3" value={type} onChange={(event) => setType(event.target.value)}><option>Add Cash</option><option>Remove Cash</option></select></label><label className="block text-sm text-gray-600">Date<input type="date" className="mt-1 h-10 w-full rounded border px-3" value={date} onChange={(event) => setDate(event.target.value)} /></label><label className="block text-sm text-gray-600">Amount<input className="mt-1 h-10 w-full rounded border px-3 text-right" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" /></label><label className="block text-sm text-gray-600">Note<textarea className="mt-1 h-20 w-full rounded border p-3" value={note} onChange={(event) => setNote(event.target.value)} /></label></div><div className="flex justify-end gap-2 border-t p-4"><Button variant="secondary" onClick={onClose}>Close</Button><Button onClick={() => { toast('Cash adjust API is not available yet'); onClose(); }}>Submit</Button></div></div></div>;
};
