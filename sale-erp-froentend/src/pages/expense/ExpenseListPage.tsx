import React, { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Edit, Eye, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { expenseApi, expenseCategoryApi } from '../../api/endpoints';
import type { ExpenseListItem } from '../../api/endpoints';
import { queryClient } from '../../app/queryClient';
import { Button } from '../../components/ui/Button';
import { Loader } from '../../components/ui/Loader';
import { Pagination } from '../../components/ui/Pagination';
import { useAuth } from '../../hooks/useAuth';
import { useConfirmation } from '../../hooks/useConfirmation';
import { useDebounce } from '../../hooks/useDebounce';
import { usePagination } from '../../hooks/usePagination';
import { formatCurrency } from '../../utils/formatCurrency';
import { formatDate } from '../../utils/formatDate';

const exportColumns = ['Date', 'Expense Number', 'Category', 'Subcategory', 'Amount', 'Payment Type', 'Created by', 'Created at'];
const expenseNumber = (expense: ExpenseListItem) => expense.expenseNo || expense.expenseNumber || `EXP/${expense.expenseId}`;

export const ExpenseListPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { confirmAction, confirmationDialog } = useConfirmation();
  const { page, setPage, handlePageChange } = usePagination();
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState(0);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const debouncedSearch = useDebounce(search);

  const expenses = useQuery({
    queryKey: ['expenses', page, pageSize, debouncedSearch],
    queryFn: () => expenseApi.getAll({ page, size: pageSize, search: debouncedSearch }),
    refetchOnMount: 'always',
  });
  const categories = useQuery({
    queryKey: ['expense-categories', 'expense-list-filter'],
    queryFn: () => expenseCategoryApi.getAll(''),
    refetchOnMount: 'always',
  });
  const remove = useMutation({
    mutationFn: expenseApi.delete,
    onSuccess: () => {
      toast.success('Expense deleted');
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
    },
    onError: (error: any) => toast.error(error?.message || 'Failed to delete expense'),
  });

  const categoryOptions = (categories.data?.data?.content || [])
    .filter((category) => category.status === 'ACTIVE' || category.id === categoryId);
  const selectedCategory = categoryOptions.find((category) => category.id === categoryId);
  const rows = (expenses.data?.data?.content || [])
    .filter((expense) => !selectedCategory || expense.categoryName === selectedCategory.name);
  const allSelected = rows.length > 0 && rows.every((expense) => selectedIds.includes(expense.expenseId));
  const exportRows = () => rows.map((expense) => [expense.expenseDate, expenseNumber(expense), expense.categoryName || '', expense.subCategoryName || '', expense.amount, expense.paymentMethodName || expense.paymentType || '', expense.createdBy || user?.userName || 'admin', expense.createdAt || expense.expenseDate]);
  const copy = async () => { await navigator.clipboard.writeText([exportColumns, ...exportRows()].map((row) => row.join('\t')).join('\n')); toast.success('Expenses copied'); };
  const download = (extension: 'csv' | 'xls') => {
    const separator = extension === 'csv' ? ',' : '\t';
    const content = [exportColumns, ...exportRows()].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(separator)).join('\n');
    const blob = new Blob([content], { type: extension === 'csv' ? 'text/csv' : 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `expenses.${extension}`; link.click(); URL.revokeObjectURL(url);
  };
  const printPdf = () => {
    const popup = window.open('', '_blank'); if (!popup) return;
    popup.document.write(`<html><head><title>Expenses</title></head><body><h2>Expense List</h2><table border="1" cellspacing="0" cellpadding="6"><thead><tr>${exportColumns.map((column) => `<th>${column}</th>`).join('')}</tr></thead><tbody>${exportRows().map((row) => `<tr>${row.map((value) => `<td>${value}</td>`).join('')}</tr>`).join('')}</tbody></table><script>window.print()</script></body></html>`);
    popup.document.close();
  };
  const deleteSelected = async () => {
    if (!selectedIds.length) return toast.error('Select at least one expense');
    const confirmed = await confirmAction({ title: 'Delete Expenses', message: 'Delete selected expenses?', confirmText: 'Delete', variant: 'danger' });
    if (!confirmed) return;
    for (const id of selectedIds) await remove.mutateAsync(id);
    setSelectedIds([]);
  };

  return (
    <div className="space-y-5">
      <div className="text-sm text-gray-500">Home &gt; Expense &gt; Expense List</div>
      <div className="overflow-hidden rounded-lg bg-white shadow">
        <div className="flex items-center justify-between border-b px-5 py-4"><h1 className="text-xl font-semibold uppercase text-gray-900">Expense List</h1><Button onClick={() => navigate('/expenses/create')} className="min-w-[165px]">Create Expense</Button></div>
        <div className="p-5">
          <label className="block max-w-xs text-sm text-gray-600">
            Category
            <select
              className="mt-1 h-10 w-full rounded border border-gray-300 px-3 disabled:cursor-not-allowed disabled:bg-gray-50"
              value={categoryId}
              disabled={categories.isLoading || categories.isError}
              onChange={(event) => {
                setCategoryId(Number(event.target.value));
                setSelectedIds([]);
              }}
            >
              <option value={0}>
                {categories.isLoading
                  ? 'Loading expense categories...'
                  : categories.isError
                    ? 'Failed to load expense categories'
                    : 'Choose one thing'}
              </option>
              {categoryOptions.map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-4">
          <label className="flex items-center gap-2 text-sm text-gray-600">Show<select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(0); }} className="h-9 rounded border border-gray-300 px-2"><option>10</option><option>20</option><option>50</option><option>100</option></select>entries</label>
          <div className="flex flex-wrap items-center"><button onClick={deleteSelected} className="h-10 rounded-l border border-red-300 px-3 text-sm text-red-500">Delete</button><button onClick={copy} className="h-10 border-y border-r px-3 text-sm">Copy</button><button onClick={() => download('xls')} className="h-10 border-y border-r px-3 text-sm">Excel</button><button onClick={() => download('csv')} className="h-10 border-y border-r px-3 text-sm">CSV</button><button onClick={printPdf} className="h-10 rounded-r border-y border-r px-3 text-sm">PDF</button></div>
          <label className="flex items-center gap-2 text-sm text-gray-600">Search:<input value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} className="h-9 rounded border border-gray-300 px-3" /></label>
        </div>
        <div className="overflow-x-auto px-3 pb-3">{expenses.isLoading ? <div className="p-10"><Loader /></div> : <table className="w-full text-sm"><thead className="bg-gray-50"><tr><th className="border p-3"><input type="checkbox" checked={allSelected} onChange={() => setSelectedIds(allSelected ? [] : rows.map((expense) => expense.expenseId))} /></th>{exportColumns.concat('Action').map((heading) => <th key={heading} className="border p-3 text-left">{heading}</th>)}</tr></thead><tbody>{rows.length ? rows.map((expense: ExpenseListItem) => <tr key={expense.expenseId} className="border-b even:bg-gray-50"><td className="border p-3"><input type="checkbox" checked={selectedIds.includes(expense.expenseId)} onChange={() => setSelectedIds((current) => current.includes(expense.expenseId) ? current.filter((id) => id !== expense.expenseId) : [...current, expense.expenseId])} /></td><td className="border p-3">{formatDate(expense.expenseDate)}</td><td className="border p-3 font-semibold">{expenseNumber(expense)}</td><td className="border p-3">{expense.categoryName || 'N/A'}</td><td className="border p-3">{expense.subCategoryName || 'N/A'}</td><td className="border p-3 font-semibold">{formatCurrency(expense.amount)}</td><td className="border p-3">{expense.paymentMethodName || expense.paymentType || 'N/A'}</td><td className="border p-3">{expense.createdBy || user?.userName || 'admin'}</td><td className="border p-3">{formatDate(expense.createdAt || expense.expenseDate)}</td><td className="border p-3"><div className="flex gap-2"><button onClick={() => navigate(`/expenses/${expense.expenseId}`)} className="text-blue-600"><Eye size={16} /></button><button onClick={() => navigate(`/expenses/${expense.expenseId}/edit`)} className="text-orange-600"><Edit size={16} /></button><button onClick={async () => { if (await confirmAction({ title: 'Delete Expense', message: 'Delete this expense?', confirmText: 'Delete', variant: 'danger' })) remove.mutate(expense.expenseId); }} className="text-red-600"><Trash2 size={16} /></button></div></td></tr>) : <tr><td colSpan={10} className="bg-gray-50 p-5 text-center">No data available in table</td></tr>}</tbody></table>}</div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4 text-sm text-gray-600"><span>Showing {rows.length ? page * pageSize + 1 : 0} to {page * pageSize + rows.length} of {expenses.data?.data?.totalElements || 0} entries</span><Pagination page={page} totalPages={expenses.data?.data?.totalPages || 1} onPageChange={handlePageChange} /></div>
      </div>
      {confirmationDialog}
    </div>
  );
};
