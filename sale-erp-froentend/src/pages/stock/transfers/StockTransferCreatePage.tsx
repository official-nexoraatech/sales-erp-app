import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { PackageSearch, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { itemApi, stockTransferApi, warehouseApi } from '../../../api/endpoints';
import type { StockTransferRequest } from '../../../api/endpoints';
import { Button } from '../../../components/ui/Button';

interface Line { itemId: number; itemName: string; stock: number; unitName: string; quantity: number }
const inputClass = 'h-10 w-full rounded border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-gray-50';

export const StockTransferCreatePage: React.FC = () => {
  const navigate = useNavigate();
  const [transferDate, setTransferDate] = useState(new Date().toISOString().slice(0, 10));
  const [fromWarehouseId, setFromWarehouseId] = useState(0);
  const [toWarehouseId, setToWarehouseId] = useState(0);
  const [selectedItem, setSelectedItem] = useState(0);
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const warehouses = useQuery({ queryKey: ['transfer-warehouses'], queryFn: () => warehouseApi.getAll() });
  const items = useQuery({ queryKey: ['transfer-items'], queryFn: () => itemApi.getAll({ page: 0, size: 100, search: '' }) });
  const warehouseRows = warehouses.data?.data || [];
  const mutation = useMutation({ mutationFn: (payload: StockTransferRequest) => stockTransferApi.create(payload), onSuccess: () => { toast.success('Stock transfer created successfully'); navigate('/stock/transfers'); }, onError: (error: any) => toast.error(error?.message || 'Failed to create stock transfer') });
  const totalQty = useMemo(() => lines.reduce((sum, line) => sum + line.quantity, 0), [lines]);

  useEffect(() => {
    if (!fromWarehouseId && warehouseRows[0]) {
      setFromWarehouseId(warehouseRows[0].id);
    }
    if (!toWarehouseId && warehouseRows[1]) {
      setToWarehouseId(warehouseRows[1].id);
    }
  }, [fromWarehouseId, toWarehouseId, warehouseRows]);

  const addItem = () => {
    const item = items.data?.data?.content.find((entry) => entry.id === selectedItem);
    if (!item) return;
    setLines((current) => current.some((line) => line.itemId === item.id) ? current : [...current, { itemId: item.id, itemName: item.itemName, stock: item.availableQty, unitName: item.unitName || 'None', quantity: 1 }]);
  };
  const submit = () => {
    if (!fromWarehouseId || !toWarehouseId || fromWarehouseId === toWarehouseId || !lines.length || lines.some((line) => line.quantity <= 0)) {
      toast.error('Select different warehouses and at least one valid item.');
      return;
    }
    mutation.mutate({ fromWarehouseId, toWarehouseId, transferDate, notes, items: lines.map(({ itemId, quantity }) => ({ itemId, quantity })) });
  };

  return (
    <div className="space-y-5">
      <div className="text-sm text-gray-500">Home &gt; Stock &gt; Stock Transfer List &gt; New Transfer</div>
      <div className="overflow-hidden rounded-lg bg-white shadow">
        <div className="border-b px-5 py-4"><h1 className="text-xl font-semibold text-gray-900">New Transfer</h1></div>
        <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-3">
          <label className="text-sm text-gray-600">Date<input type="date" className={`${inputClass} mt-1`} value={transferDate} onChange={(event) => setTransferDate(event.target.value)} /></label>
          <label className="text-sm text-gray-600">From Warehouse<select className={`${inputClass} mt-1`} value={fromWarehouseId} onChange={(event) => setFromWarehouseId(Number(event.target.value))}>{warehouseRows.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label>
          <label className="text-sm text-gray-600">To Warehouse<select className={`${inputClass} mt-1`} value={toWarehouseId} onChange={(event) => setToWarehouseId(Number(event.target.value))}>{warehouseRows.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label>
          <label className="text-sm text-gray-600">Transfer Code<div className="mt-1 flex"><input className={`${inputClass} rounded-r-none`} value="ST/" readOnly /><span className="flex h-10 items-center border-y border-gray-300 px-3">#</span><input className={`${inputClass} rounded-l-none`} value="2" readOnly /></div></label>
        </div>
        <h2 className="border-y px-5 py-4 text-lg font-semibold">Items</h2>
        <div className="p-5">
          <label className="text-sm text-gray-600">Enter Item Name<div className="mt-1 flex max-w-3xl"><span className="flex h-10 w-10 items-center justify-center rounded-l border border-r-0 border-gray-300 text-blue-500"><PackageSearch size={16} /></span><select className={`${inputClass} rounded-l-none rounded-r-none`} value={selectedItem} onChange={(event) => setSelectedItem(Number(event.target.value))}><option value={0}>Scan Barcode/Search Item/Brand Name</option>{items.data?.data?.content.map((item) => <option key={item.id} value={item.id}>{item.itemName}</option>)}</select><button type="button" onClick={addItem} className="h-10 rounded-r border border-l-0 border-blue-400 px-4 text-blue-600">Add</button></div></label>
        </div>
        <div className="overflow-x-auto px-5"><table className="w-full text-sm"><thead className="bg-gray-50"><tr>{['ACTION', 'ITEM', 'STOCK', 'UNIT', 'QUANTITY TO TRANSFER'].map((heading) => <th key={heading} className="border p-3 text-left">{heading}</th>)}</tr></thead><tbody>{lines.length ? lines.map((line, index) => <tr key={line.itemId}><td className="border p-3"><button onClick={() => setLines((current) => current.filter((_, i) => i !== index))} className="text-red-600"><Trash2 size={16} /></button></td><td className="border p-3">{line.itemName}</td><td className="border p-3">{line.stock}</td><td className="border p-3">{line.unitName}</td><td className="border p-3"><input type="number" min="0" value={line.quantity} onChange={(event) => setLines((current) => current.map((entry, i) => i === index ? { ...entry, quantity: Number(event.target.value) } : entry))} className="w-28 rounded border px-2 py-1" /></td></tr>) : <tr><td colSpan={5} className="bg-gray-50 p-4 text-center italic">No items are added yet!!</td></tr>}<tr><td colSpan={4} className="border p-2 text-right font-bold">Total</td><td className="border p-2 font-bold">{totalQty}</td></tr></tbody></table></div>
        <div className="p-5"><label className="text-sm text-gray-600">Note<textarea className="mt-1 h-20 w-full max-w-3xl rounded border border-gray-300 p-3" value={notes} onChange={(event) => setNotes(event.target.value)} /></label></div>
        <div className="flex gap-3 border-t p-5"><Button onClick={submit} isLoading={mutation.isPending}>Submit</Button><Button variant="secondary" onClick={() => navigate('/stock/transfers')}>Close</Button></div>
      </div>
    </div>
  );
};
