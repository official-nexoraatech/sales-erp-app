import React, { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Edit, Eye, PackageSearch, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { brandApi, categoryApi, itemApi } from '../../api/endpoints';
import type { ItemListItem } from '../../api/endpoints';
import { queryClient } from '../../app/queryClient';
import { Button } from '../../components/ui/Button';
import { Loader } from '../../components/ui/Loader';
import { Pagination } from '../../components/ui/Pagination';
import { useAuth } from '../../hooks/useAuth';
import { useDebounce } from '../../hooks/useDebounce';
import { usePagination } from '../../hooks/usePagination';
import { formatCurrency } from '../../utils/formatCurrency';

const exportColumns = ['Name', 'Item Code', 'SKU', 'Brand', 'Category', 'Sale Price', 'Purchase Price', 'Quantity', 'Tracking Type', 'Created by'];

export const ItemListPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { page, setPage, handlePageChange } = usePagination();
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState('');
  const [itemType, setItemType] = useState('');
  const [brandId, setBrandId] = useState(0);
  const [categoryId, setCategoryId] = useState(0);
  const [selectedUser, setSelectedUser] = useState(user?.userName || '');
  const [warehouseStock, setWarehouseStock] = useState('All');
  const [trackingType, setTrackingType] = useState('');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const debouncedSearch = useDebounce(search);

  const items = useQuery({
    queryKey: ['items', page, pageSize, debouncedSearch, categoryId, brandId],
    queryFn: () => itemApi.getAll({ page, size: pageSize, search: debouncedSearch, categoryId: categoryId || undefined, brandId: brandId || undefined }),
  });
  const categories = useQuery({ queryKey: ['item-list-categories'], queryFn: () => categoryApi.getAll({ page: 0, size: 100, search: '' }) });
  const brands = useQuery({
    queryKey: ['item-list-brands', categoryId],
    queryFn: () => brandApi.getAll({ page: 0, size: 100, search: '', categoryId }),
    enabled: categoryId > 0,
  });
  const remove = useMutation({
    mutationFn: itemApi.delete,
    onSuccess: () => {
      toast.success('Item deleted');
      queryClient.invalidateQueries({ queryKey: ['items'] });
    },
    onError: (error: any) => toast.error(error?.message || 'Failed to delete item'),
  });

  const rows = (items.data?.data?.content || [])
    .filter((item) => !trackingType || item.trackingType === trackingType);
  const allSelected = rows.length > 0 && rows.every((item) => selectedIds.includes(item.id));

  const exportRows = () => rows.map((item) => [item.itemName, item.itemCode, item.sku, item.brandName || '', item.categoryName || '', item.salePrice, item.purchasePrice || 0, item.availableQty, item.trackingType || 'Regular', user?.userName || 'admin']);
  const copy = async () => {
    await navigator.clipboard.writeText([exportColumns, ...exportRows()].map((row) => row.join('\t')).join('\n'));
    toast.success('Items copied');
  };
  const download = (extension: 'csv' | 'xls') => {
    const separator = extension === 'csv' ? ',' : '\t';
    const content = [exportColumns, ...exportRows()].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(separator)).join('\n');
    const blob = new Blob([content], { type: extension === 'csv' ? 'text/csv' : 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `items.${extension}`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const printPdf = () => {
    const popup = window.open('', '_blank');
    if (!popup) return;
    popup.document.write(`<html><head><title>Items</title></head><body><h2>Item List</h2><table border="1" cellspacing="0" cellpadding="6"><thead><tr>${exportColumns.map((column) => `<th>${column}</th>`).join('')}</tr></thead><tbody>${exportRows().map((row) => `<tr>${row.map((value) => `<td>${value}</td>`).join('')}</tr>`).join('')}</tbody></table><script>window.print()</script></body></html>`);
    popup.document.close();
  };
  const deleteSelected = async () => {
    if (!selectedIds.length) return toast.error('Select at least one item');
    if (!confirm('Delete selected items?')) return;
    for (const id of selectedIds) await remove.mutateAsync(id);
    setSelectedIds([]);
  };

  return (
    <div className="space-y-5">
      <div className="text-sm text-gray-500">Home &gt; Items &gt; Item List</div>
      <div className="overflow-hidden rounded-lg bg-white shadow">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h1 className="text-xl font-semibold uppercase text-gray-900">Item List</h1>
          <div className="flex gap-2"><Button variant="outline" className="min-w-[120px]">Import</Button><Button onClick={() => navigate('/items/create')} className="min-w-[145px]">Create Item</Button></div>
        </div>
        <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-3">
          <label className="text-sm text-gray-600">Item Type<select className="mt-1 h-10 w-full rounded border border-gray-300 px-3" value={itemType} onChange={(event) => setItemType(event.target.value)}><option value="">Choose one thing</option><option>Product</option><option>Service</option></select></label>
          <label className="text-sm text-gray-600">Category<select className="mt-1 h-10 w-full rounded border border-gray-300 px-3" value={categoryId} disabled={categories.isLoading} onChange={(event) => { setCategoryId(Number(event.target.value)); setBrandId(0); setPage(0); }}><option value={0}>{categories.isLoading ? 'Loading categories...' : 'Choose one thing'}</option>{(categories.data?.data?.content || []).map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
          <label className="text-sm text-gray-600">Brand<select className="mt-1 h-10 w-full rounded border border-gray-300 px-3" value={brandId} disabled={!categoryId || brands.isLoading} onChange={(event) => { setBrandId(Number(event.target.value)); setPage(0); }}><option value={0}>{!categoryId ? 'Select category first' : brands.isLoading ? 'Loading brands...' : 'Choose one thing'}</option>{(brands.data?.data?.content || []).map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
          <label className="text-sm text-gray-600">User<select className="mt-1 h-10 w-full rounded border border-gray-300 px-3" value={selectedUser} onChange={(event) => setSelectedUser(event.target.value)}><option value="">Choose one thing</option>{user?.userName && <option value={user.userName}>{user.userName}</option>}</select></label>
          <label className="text-sm text-gray-600">Warehouse Stock<select className="mt-1 h-10 w-full rounded border border-gray-300 px-3" value={warehouseStock} onChange={(event) => setWarehouseStock(event.target.value)}><option>All</option><option>In Stock</option><option>Low Stock</option></select></label>
          <label className="text-sm text-gray-600">Tracking Type<select className="mt-1 h-10 w-full rounded border border-gray-300 px-3" value={trackingType} onChange={(event) => setTrackingType(event.target.value)}><option value="">Choose one thing</option><option>Regular</option><option>Batch</option></select></label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-4">
          <label className="flex items-center gap-2 text-sm text-gray-600">Show<select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(0); }} className="h-9 rounded border border-gray-300 px-2"><option>10</option><option>20</option><option>50</option><option>100</option></select>entries</label>
          <div className="flex flex-wrap items-center"><button onClick={deleteSelected} className="h-10 rounded-l border border-red-300 px-3 text-sm text-red-500">Delete</button><button onClick={copy} className="h-10 border-y border-r px-3 text-sm">Copy</button><button onClick={() => download('xls')} className="h-10 border-y border-r px-3 text-sm">Excel</button><button onClick={() => download('csv')} className="h-10 border-y border-r px-3 text-sm">CSV</button><button onClick={printPdf} className="h-10 border-y border-r px-3 text-sm">PDF</button><button onClick={() => queryClient.invalidateQueries({ queryKey: ['items'] })} className="h-10 rounded-r border-y border-r px-3 text-sm">↻</button></div>
          <label className="flex items-center gap-2 text-sm text-gray-600">Search:<input value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} className="h-9 rounded border border-gray-300 px-3" /></label>
        </div>
        <div className="overflow-x-auto px-3 pb-3">
          {items.isLoading ? <div className="p-10"><Loader /></div> : <table className="w-full text-sm">
            <thead className="bg-gray-50"><tr><th className="border p-3"><input type="checkbox" checked={allSelected} onChange={() => setSelectedIds(allSelected ? [] : rows.map((item) => item.id))} /></th>{exportColumns.concat('Action').map((heading) => <th key={heading} className="border p-3 text-left">{heading}</th>)}</tr></thead>
            <tbody>{rows.length ? rows.map((item: ItemListItem) => <tr key={item.id} className="border-b even:bg-gray-50"><td className="border p-3"><input type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => setSelectedIds((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])} /></td><td className="border p-3 font-semibold">{item.itemName}</td><td className="border p-3">{item.itemCode}</td><td className="border p-3">{item.sku}</td><td className="border p-3">{item.brandName || ''}</td><td className="border p-3">{item.categoryName || 'General'}</td><td className="border p-3">{formatCurrency(item.salePrice)}</td><td className="border p-3">{formatCurrency(item.purchasePrice || 0)}</td><td className="border p-3">{item.availableQty} {item.unitName || 'None'}</td><td className="border p-3">{item.trackingType || 'Regular'}</td><td className="border p-3">{user?.userName || 'admin'}</td><td className="border p-3"><div className="flex gap-2"><button onClick={() => navigate(`/items/${item.id}`)} className="text-blue-600"><Eye size={16} /></button><button onClick={() => navigate(`/items/${item.id}/stock`)} className="text-green-600"><PackageSearch size={16} /></button><button onClick={() => navigate(`/items/${item.id}/edit`)} className="text-orange-600"><Edit size={16} /></button><button onClick={() => confirm('Delete this item?') && remove.mutate(item.id)} className="text-red-600"><Trash2 size={16} /></button></div></td></tr>) : <tr><td colSpan={12} className="bg-gray-50 p-5 text-center">No data available in table</td></tr>}</tbody>
          </table>}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4 text-sm text-gray-600"><span>Showing {rows.length ? page * pageSize + 1 : 0} to {page * pageSize + rows.length} of {items.data?.data?.totalElements || 0} entries</span><Pagination page={page} totalPages={items.data?.data?.totalPages || 1} onPageChange={handlePageChange} /></div>
      </div>
    </div>
  );
};
