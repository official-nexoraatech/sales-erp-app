import React, { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Edit, Eye, PackageSearch, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { brandApi, categoryApi, itemApi, warehouseApi } from '../../api/endpoints';
import type { ItemListItem } from '../../api/endpoints';
import type { ItemStatus } from '../../types/api.types';
import { queryClient } from '../../app/queryClient';
import { TableExportButtons } from '../../components/common/TableExportButtons';
import { Button } from '../../components/ui/Button';
import { Loader } from '../../components/ui/Loader';
import { Pagination } from '../../components/ui/Pagination';
import { useAuth } from '../../hooks/useAuth';
import { useConfirmation } from '../../hooks/useConfirmation';
import { useDebounce } from '../../hooks/useDebounce';
import { usePagination } from '../../hooks/usePagination';
import { formatCurrency } from '../../utils/formatCurrency';
import { formatDate } from '../../utils/formatDate';
import { PERMISSIONS } from '../../auth/permissions';

type TableColumn = {
  heading: string;
  render: (item: ItemListItem) => React.ReactNode;
  exportValue: (item: ItemListItem) => string | number;
};

const text = (value: unknown, fallback = '') => {
  if (value === null || value === undefined || value === '') return fallback;
  return String(value);
};
const number = (value: unknown) => Number(value || 0);
const date = (value?: string) => (value ? formatDate(value) : '');
const itemStatusOptions: Array<{ value: ItemStatus; label: string }> = [
  { value: 'IN_STOCK', label: 'In Stock' },
  { value: 'LOW_STOCK', label: 'Low Stock' },
  { value: 'OUT_OF_STOCK', label: 'Out of Stock' },
];
const itemStatusLabel = (status: ItemListItem['status'] | '') =>
  itemStatusOptions.find((option) => option.value === status)?.label || text(status);

const itemColumns: TableColumn[] = [
  { heading: 'Name', render: (item) => <span className="font-semibold">{item.itemName}</span>, exportValue: (item) => item.itemName },
  { heading: 'Item Code', render: (item) => text(item.itemCode), exportValue: (item) => text(item.itemCode) },
  { heading: 'HSN', render: (item) => text(item.hsnCode), exportValue: (item) => text(item.hsnCode) },
  { heading: 'SKU', render: (item) => text(item.sku), exportValue: (item) => text(item.sku) },
  { heading: 'Category', render: (item) => text(item.categoryName, 'General'), exportValue: (item) => text(item.categoryName, 'General') },
  { heading: 'Brand', render: (item) => text(item.brandName), exportValue: (item) => text(item.brandName) },
  { heading: 'Base Unit', render: (item) => text(item.unitName || item.baseUnitName), exportValue: (item) => text(item.unitName || item.baseUnitName) },
  { heading: 'Purchase Price', render: (item) => formatCurrency(number(item.purchasePrice)), exportValue: (item) => number(item.purchasePrice) },
  { heading: 'Purchase With Tax', render: (item) => formatCurrency(number(item.purchasePriceWithTax)), exportValue: (item) => number(item.purchasePriceWithTax) },
  { heading: 'Tax %', render: (item) => number(item.taxPercentage), exportValue: (item) => number(item.taxPercentage) },
  { heading: 'Sale Price', render: (item) => formatCurrency(number(item.salePrice)), exportValue: (item) => number(item.salePrice) },
  { heading: 'Wholesale Price', render: (item) => formatCurrency(number(item.wholesalePrice)), exportValue: (item) => number(item.wholesalePrice) },
  { heading: 'MRP', render: (item) => formatCurrency(number(item.mrp)), exportValue: (item) => number(item.mrp) },
  { heading: 'MSP', render: (item) => formatCurrency(number(item.msp)), exportValue: (item) => number(item.msp) },
  { heading: 'Discount %', render: (item) => number(item.discountPercentage), exportValue: (item) => number(item.discountPercentage) },
  { heading: 'Profit %', render: (item) => number(item.profitMargin), exportValue: (item) => number(item.profitMargin) },
  { heading: 'Batch No', render: (item) => text(item.batchNo), exportValue: (item) => text(item.batchNo) },
  { heading: 'Mfg Date', render: (item) => date(item.manufacturingDate), exportValue: (item) => date(item.manufacturingDate) },
  { heading: 'Exp Date', render: (item) => date(item.expiryDate), exportValue: (item) => date(item.expiryDate) },
  { heading: 'Opening Qty', render: (item) => number(item.openingQuantity), exportValue: (item) => number(item.openingQuantity) },
  { heading: 'Available Qty', render: (item) => number(item.availableQty), exportValue: (item) => number(item.availableQty) },
  { heading: 'Reserved Qty', render: (item) => number(item.reservedQty), exportValue: (item) => number(item.reservedQty) },
  { heading: 'Minimum Stock', render: (item) => number(item.minimumStock), exportValue: (item) => number(item.minimumStock) },
  { heading: 'Warehouse', render: (item) => text(item.warehouseName), exportValue: (item) => text(item.warehouseName) },
  { heading: 'Description', render: (item) => <span className="line-clamp-2">{text(item.description)}</span>, exportValue: (item) => text(item.description) },
  { heading: 'Status', render: (item) => itemStatusLabel(item.status), exportValue: (item) => itemStatusLabel(item.status) },
];

const exportColumns = [...itemColumns.map((column) => column.heading), 'Created by'];

export const ItemListPage: React.FC = () => {
  const navigate = useNavigate();
  const { user, hasPermission } = useAuth();
  const { confirmAction, confirmationDialog } = useConfirmation();
  const canViewCategories = hasPermission(PERMISSIONS.CATEGORY_VIEW);
  const canViewBrands = hasPermission(PERMISSIONS.BRAND_VIEW);
  const canViewUnits = hasPermission(PERMISSIONS.UNIT_VIEW);
  const canUseItemFormLookups = canViewCategories && canViewBrands && canViewUnits;
  const canCreate = hasPermission(PERMISSIONS.ITEM_CREATE) && canUseItemFormLookups;
  const canUpdate = hasPermission(PERMISSIONS.ITEM_UPDATE) && canUseItemFormLookups;
  const canDelete = hasPermission(PERMISSIONS.ITEM_DELETE);
  const canViewStock = hasPermission(PERMISSIONS.ITEM_STOCK_VIEW);
  const { page, setPage, handlePageChange } = usePagination();
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState('');
  const [brandId, setBrandId] = useState(0);
  const [categoryId, setCategoryId] = useState(0);
  const [selectedUser, setSelectedUser] = useState(user?.userName || '');
  const [warehouseId, setWarehouseId] = useState(0);
  const [itemStatus, setItemStatus] = useState<ItemStatus | ''>('');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const debouncedSearch = useDebounce(search);

  const items = useQuery({
    queryKey: ['items', page, pageSize, debouncedSearch, categoryId, brandId, warehouseId, itemStatus],
    queryFn: () => itemApi.getAll({
      page,
      size: pageSize,
      search: debouncedSearch,
      categoryId: categoryId || undefined,
      brandId: brandId || undefined,
      warehouseId: warehouseId || undefined,
      status: itemStatus || undefined,
    }),
  });
  const categories = useQuery({ queryKey: ['item-list-categories'], queryFn: () => categoryApi.getAll({ page: 0, size: 100, search: '' }), enabled: canViewCategories });
  const brands = useQuery({
    queryKey: ['item-list-brands', categoryId],
    queryFn: () => brandApi.getByCategoryId(categoryId),
    enabled: canViewBrands && categoryId > 0,
  });
  const warehouses = useQuery({ queryKey: ['item-list-warehouses'], queryFn: () => warehouseApi.getAll() });
  const remove = useMutation({
    mutationFn: itemApi.delete,
    onSuccess: () => {
      toast.success('Item deleted');
      queryClient.invalidateQueries({ queryKey: ['items'] });
    },
    onError: (error: any) => toast.error(error?.message || 'Failed to delete item'),
  });

  const rows = (items.data?.data?.content || [])
    .filter((item) => !warehouseId || item.warehouseId === warehouseId);
  const allSelected = rows.length > 0 && rows.every((item) => selectedIds.includes(item.id));
  const exportRows = () => rows.map((item) => [...itemColumns.map((column) => column.exportValue(item)), user?.userName || 'admin']);

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
    const confirmed = await confirmAction({ title: 'Delete Items', message: 'Delete selected items?', confirmText: 'Delete', variant: 'danger' });
    if (!confirmed) return;
    for (const id of selectedIds) await remove.mutateAsync(id);
    setSelectedIds([]);
  };

  return (
    <div className="space-y-5">
      <div className="text-sm text-gray-500">Home &gt; Items &gt; Item List</div>
      <div className="overflow-hidden rounded-lg bg-white shadow">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h1 className="text-xl font-semibold uppercase text-gray-900">Item List</h1>
          {canCreate && <div className="flex gap-2">{canCreate && <Button onClick={() => navigate('/items/create')} className="min-w-[145px]">Create Item</Button>}</div>}
        </div>
        <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-3">
          {canViewCategories && <label className="text-sm text-gray-600">Category<select className="mt-1 h-10 w-full rounded border border-gray-300 px-3" value={categoryId} disabled={categories.isLoading} onChange={(event) => { setCategoryId(Number(event.target.value)); setBrandId(0); setPage(0); }}><option value={0}>{categories.isLoading ? 'Loading categories...' : 'Choose one thing'}</option>{(categories.data?.data?.content || []).map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>}
          {canViewBrands && <label className="text-sm text-gray-600">Brand<select className="mt-1 h-10 w-full rounded border border-gray-300 px-3" value={brandId} disabled={!categoryId || brands.isLoading} onChange={(event) => { setBrandId(Number(event.target.value)); setPage(0); }}><option value={0}>{!categoryId ? 'Select category first' : brands.isLoading ? 'Loading brands...' : 'Choose one thing'}</option>{(brands.data?.data?.content || []).map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>}
          <label className="text-sm text-gray-600">User<select className="mt-1 h-10 w-full rounded border border-gray-300 px-3" value={selectedUser} onChange={(event) => setSelectedUser(event.target.value)}><option value="">Choose one thing</option>{user?.userName && <option value={user.userName}>{user.userName}</option>}</select></label>
          <label className="text-sm text-gray-600">Warehouse Stock<select className="mt-1 h-10 w-full rounded border border-gray-300 px-3" value={warehouseId} disabled={warehouses.isLoading} onChange={(event) => { setWarehouseId(Number(event.target.value)); setPage(0); }}><option value={0}>{warehouses.isLoading ? 'Loading warehouses...' : 'All warehouses'}</option>{(warehouses.data?.data || []).map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label>
          <label className="text-sm text-gray-600">Item Status<select className="mt-1 h-10 w-full rounded border border-gray-300 px-3" value={itemStatus} onChange={(event) => { setItemStatus(event.target.value as ItemStatus | ''); setPage(0); }}><option value="">All statuses</option>{itemStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-4">
          <label className="flex items-center gap-2 text-sm text-gray-600">Show<select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(0); }} className="h-9 rounded border border-gray-300 px-2"><option>10</option><option>20</option><option>50</option><option>100</option></select>entries</label>
          <TableExportButtons
            leadingButton={canDelete && <button onClick={deleteSelected} className="h-10 rounded-l border border-red-300 px-3 text-sm text-red-500 transition-all active:scale-95 active:bg-red-50">Delete</button>}
            onCopy={copy}
            onDownloadExcel={() => download('xls')}
            onDownloadCsv={() => download('csv')}
            onPrint={printPdf}
            onRefresh={() => queryClient.invalidateQueries({ queryKey: ['items'] })}
          />
          <label className="flex items-center gap-2 text-sm text-gray-600">Search:<input value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} className="h-9 rounded border border-gray-300 px-3" /></label>
        </div>
        <div className="overflow-x-auto px-3 pb-3">
          {items.isLoading ? <div className="p-10"><Loader /></div> : (
            <table className="w-full min-w-[2600px] text-sm">
              <thead className="bg-gray-50"><tr>{canDelete && <th className="border p-3"><input type="checkbox" checked={allSelected} onChange={() => setSelectedIds(allSelected ? [] : rows.map((item) => item.id))} /></th>}{itemColumns.map((column) => <th key={column.heading} className="border p-3 text-left">{column.heading}</th>)}<th className="border p-3 text-left">Created by</th><th className="border p-3 text-left">Action</th></tr></thead>
              <tbody>
                {rows.length ? rows.map((item) => (
                  <tr key={item.id} className="border-b even:bg-gray-50">
                    {canDelete && <td className="border p-3"><input type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => setSelectedIds((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])} /></td>}
                    {itemColumns.map((column) => <td key={column.heading} className="border p-3 align-top">{column.render(item)}</td>)}
                    <td className="border p-3">{user?.userName || 'admin'}</td>
                    <td className="border p-3">
                      <div className="flex gap-2">
                        <button title="View item" onClick={() => navigate(`/items/${item.id}`)} className="text-blue-600"><Eye size={16} /></button>
                        {canViewStock && <button title="View stock" onClick={() => navigate(`/items/${item.id}/stock`)} className="text-green-600"><PackageSearch size={16} /></button>}
                        {canUpdate && <button title="Edit item" onClick={() => navigate(`/items/${item.id}/edit`)} className="text-orange-600"><Edit size={16} /></button>}
                        {canDelete && <button title="Delete item" onClick={async () => { if (await confirmAction({ title: 'Delete Item', message: 'Delete this item?', confirmText: 'Delete', variant: 'danger' })) remove.mutate(item.id); }} className="text-red-600"><Trash2 size={16} /></button>}
                      </div>
                    </td>
                  </tr>
                )) : <tr><td colSpan={itemColumns.length + (canDelete ? 3 : 2)} className="bg-gray-50 p-5 text-center">No data available in table</td></tr>}
              </tbody>
            </table>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4 text-sm text-gray-600"><span>Showing {rows.length ? page * pageSize + 1 : 0} to {page * pageSize + rows.length} of {items.data?.data?.totalElements || 0} entries</span><Pagination page={page} totalPages={items.data?.data?.totalPages || 1} onPageChange={handlePageChange} /></div>
      </div>
      {confirmationDialog}
    </div>
  );
};
