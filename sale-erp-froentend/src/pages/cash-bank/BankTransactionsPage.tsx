import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { bankAccountApi } from '../../api/endpoints';
import type { MoneyTransaction } from '../../api/endpoints';
import { PERMISSIONS } from '../../auth/permissions';
import { Button } from '../../components/ui/Button';
import { Loader } from '../../components/ui/Loader';
import { Pagination } from '../../components/ui/Pagination';
import { useAuth } from '../../hooks/useAuth';
import { usePagination } from '../../hooks/usePagination';
import { formatCurrency } from '../../utils/formatCurrency';
import { formatDate } from '../../utils/formatDate';

const exportColumns = ['Type', 'Date', 'Party Name', 'Amount', 'Created by', 'Action'];
const txDate = (tx: MoneyTransaction) => tx.date || tx.transactionDate || '';

export const BankTransactionsPage: React.FC = () => {
  const navigate = useNavigate();
  const { user, hasPermission } = useAuth();
  const canViewBankAccounts = hasPermission(PERMISSIONS.BANK_ACCOUNT_VIEW);
  const { page, setPage, handlePageChange } = usePagination();
  const [pageSize, setPageSize] = useState(10);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [search, setSearch] = useState('');
  const accounts = useQuery({ queryKey: ['bank-accounts'], queryFn: bankAccountApi.getAll });
  const firstAccountId = accounts.data?.data?.content?.[0]?.id;
  const transactions = useQuery({ queryKey: ['bank-transactions', firstAccountId], queryFn: () => bankAccountApi.getTransactions(firstAccountId || 0), enabled: !!firstAccountId });
  const rows = (transactions.data?.data?.content || []).filter((tx) => !search || JSON.stringify(tx).toLowerCase().includes(search.toLowerCase())).filter((tx) => !fromDate || txDate(tx) >= fromDate).filter((tx) => !toDate || txDate(tx) <= toDate);
  const exportRows = () => rows.map((tx) => [tx.type, txDate(tx), tx.partyName || '', tx.amount, tx.createdBy || user?.userName || 'admin', '']);
  const copy = async () => { await navigator.clipboard.writeText([exportColumns, ...exportRows()].map((row) => row.join('\t')).join('\n')); toast.success('Bank transactions copied'); };
  const download = (extension: 'csv' | 'xls') => { const separator = extension === 'csv' ? ',' : '\t'; const content = [exportColumns, ...exportRows()].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(separator)).join('\n'); const blob = new Blob([content], { type: extension === 'csv' ? 'text/csv' : 'application/vnd.ms-excel' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `bank-transactions.${extension}`; link.click(); URL.revokeObjectURL(url); };
  return <div className="space-y-5"><div className="text-sm text-gray-500">Home &gt; Cash &amp; Bank &gt; Bank Transactions</div><div className="overflow-hidden rounded-lg bg-white shadow"><div className="flex items-center justify-between border-b px-5 py-4"><h1 className="text-xl font-semibold uppercase text-gray-900">Bank Transactions</h1>{canViewBankAccounts && <Button variant="outline" onClick={() => navigate('/cash-bank/bank-accounts')}>Bank Accounts</Button>}</div><div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2"><label className="text-sm text-gray-600">From Date<input type="date" className="mt-1 h-10 w-full rounded border px-3" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label><label className="text-sm text-gray-600">To Date<input type="date" className="mt-1 h-10 w-full rounded border px-3" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label></div><div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-4"><label className="flex items-center gap-2 text-sm">Show<select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(0); }} className="h-9 rounded border px-2"><option>10</option><option>20</option><option>50</option><option>100</option></select>entries</label><div className="flex"><button onClick={copy} className="h-10 rounded-l border px-3 text-sm">Copy</button><button onClick={() => download('xls')} className="h-10 border-y border-r px-3 text-sm">Excel</button><button onClick={() => download('csv')} className="h-10 border-y border-r px-3 text-sm">CSV</button><button onClick={() => window.print()} className="h-10 rounded-r border-y border-r px-3 text-sm">PDF</button></div><label className="flex items-center gap-2 text-sm">Search:<input value={search} onChange={(event) => setSearch(event.target.value)} className="h-9 rounded border px-3" /></label></div><div className="overflow-x-auto px-3 pb-3">{transactions.isLoading ? <div className="p-10"><Loader /></div> : <table className="w-full text-sm"><thead className="bg-gray-50"><tr>{exportColumns.map((heading) => <th key={heading} className="border p-3 text-left">{heading}</th>)}</tr></thead><tbody>{rows.length ? rows.map((tx, index) => <tr key={tx.id || tx.transactionId || index} className="border-b even:bg-gray-50"><td className="border p-3">{tx.type}</td><td className="border p-3">{formatDate(txDate(tx))}</td><td className="border p-3">{tx.partyName || 'N/A'}</td><td className="border p-3">{formatCurrency(tx.amount)}</td><td className="border p-3">{tx.createdBy || user?.userName || 'admin'}</td><td className="border p-3">NA</td></tr>) : <tr><td colSpan={6} className="bg-gray-50 p-5 text-center">No data available in table</td></tr>}</tbody></table>}</div><div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4 text-sm text-gray-600"><span>Showing {rows.length ? page * pageSize + 1 : 0} to {page * pageSize + rows.length} of {transactions.data?.data?.totalElements || 0} entries</span><Pagination page={page} totalPages={transactions.data?.data?.totalPages || 1} onPageChange={handlePageChange} /></div></div></div>;
};
