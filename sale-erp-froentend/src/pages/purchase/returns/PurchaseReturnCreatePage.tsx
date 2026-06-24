import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CirclePlus, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { itemApi, purchaseApi, purchaseReturnApi, supplierApi, warehouseApi } from '../../../api/endpoints';
import type { PurchaseReturnRequest } from '../../../api/endpoints';
import { CountryStateSelect } from '../../../components/form/CountryStateSelect';
import { Button } from '../../../components/ui/Button';
import { NumericInput } from '../../../components/ui/NumericInput';

interface Line { itemId: number; itemName: string; batchId: number; quantity: number; rate: number }
const inputClass = 'h-10 w-full rounded border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-gray-50';

export const PurchaseReturnCreatePage: React.FC = () => {
  const navigate = useNavigate();
  const today = new Date().toISOString().slice(0, 10);
  const [supplierId, setSupplierId] = useState(0);
  const [purchaseId, setPurchaseId] = useState(0);
  const [returnDate, setReturnDate] = useState(today);
  const [reason, setReason] = useState('');
  const [warehouseId, setWarehouseId] = useState(0);
  const [stateId, setStateId] = useState(0);
  const [selectedItem, setSelectedItem] = useState(0);
  const [roundOff, setRoundOff] = useState(false);
  const [amount, setAmount] = useState('');
  const [paymentType, setPaymentType] = useState('');
  const [paymentNote, setPaymentNote] = useState('');
  const [lines, setLines] = useState<Line[]>([]);

  const suppliers = useQuery({ queryKey: ['purchase-return-form-suppliers'], queryFn: () => supplierApi.getAll({ page: 0, size: 100, search: '' }) });
  const purchases = useQuery({ queryKey: ['purchase-return-form-purchases'], queryFn: () => purchaseApi.getAll({ page: 0, size: 100, search: '' }) });
  const warehouses = useQuery({ queryKey: ['purchase-return-form-warehouses'], queryFn: () => warehouseApi.getAll() });
  const items = useQuery({ queryKey: ['purchase-return-form-items'], queryFn: () => itemApi.getAll({ page: 0, size: 100, search: '' }) });
  const warehouseRows = warehouses.data?.data || [];
  const mutation = useMutation({
    mutationFn: (payload: PurchaseReturnRequest) => purchaseReturnApi.create(payload),
    onSuccess: () => { toast.success('Purchase return created successfully'); navigate('/purchase/returns'); },
    onError: (error: any) => toast.error(error?.message || 'Failed to create purchase return'),
  });

  useEffect(() => {
    if (!warehouseId && warehouseRows.length) {
      setWarehouseId(warehouseRows[0].id);
    }
  }, [warehouseId, warehouseRows]);

  const addItem = () => {
    const item = items.data?.data?.content.find((entry) => entry.id === selectedItem);
    if (!item) return;
    setLines((current) => current.some((line) => line.itemId === item.id) ? current : [...current, { itemId: item.id, itemName: item.itemName, batchId: 0, quantity: 1, rate: item.salePrice }]);
  };
  const update = (index: number, field: keyof Pick<Line, 'batchId' | 'quantity' | 'rate'>, value: number) => setLines((current) => current.map((line, i) => i === index ? { ...line, [field]: value } : line));
  const total = useMemo(() => lines.reduce((sum, line) => sum + line.quantity * line.rate, 0), [lines]);
  const grandTotal = roundOff ? Math.round(total) : total;
  const submit = () => {
    if (!purchaseId || !supplierId || !lines.length || lines.some((line) => line.quantity <= 0)) {
      toast.error('Select purchase, supplier, and at least one valid item.');
      return;
    }
    mutation.mutate({ purchaseId, supplierId, returnDate, reason, items: lines.map(({ itemId, batchId, quantity, rate }) => ({ itemId, batchId, quantity, rate })) });
  };

  return (
    <div className="space-y-5">
      <div className="text-sm text-gray-500">Home &gt; Purchase &gt; Purchase Return/Dr.Note &gt; Purchase Return Create</div>
      <div className="overflow-hidden rounded-lg bg-white shadow">
        <div className="border-b px-5 py-4"><h1 className="text-xl font-semibold text-gray-900">Purchase Return Details</h1></div>
        <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-3">
          <label className="text-sm text-gray-600">Supplier<div className="mt-1 flex"><select className={`${inputClass} rounded-r-none`} value={supplierId} onChange={(event) => setSupplierId(Number(event.target.value))}><option value={0}>Select Supplier</option>{suppliers.data?.data?.content.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.supplierName}</option>)}</select><button type="button" className="flex h-10 w-9 items-center justify-center rounded-r border border-l-0 border-gray-300 text-blue-500"><CirclePlus size={16} /></button></div></label>
          <label className="text-sm text-gray-600">Date<input type="date" className={`${inputClass} mt-1`} value={returnDate} onChange={(event) => setReturnDate(event.target.value)} /></label>
          <label className="text-sm text-gray-600">Return ID<div className="mt-1 flex"><input className={`${inputClass} rounded-r-none`} value="PR/" readOnly /><span className="flex h-10 items-center border-y border-gray-300 px-3">#</span><input className={`${inputClass} rounded-l-none`} value="1" readOnly /></div></label>
          <label className="text-sm text-gray-600">Reference No.<select className={`${inputClass} mt-1`} value={purchaseId} onChange={(event) => setPurchaseId(Number(event.target.value))}><option value={0}>(Optional)</option>{purchases.data?.data?.content.map((purchase) => <option key={purchase.purchaseId} value={purchase.purchaseId}>{purchase.purchaseNo || purchase.purchaseCode || `PB/${purchase.purchaseId}`}</option>)}</select></label>
          <CountryStateSelect stateId={stateId} onStateChange={setStateId} className={inputClass} />
        </div>
        <h2 className="border-y px-5 py-4 text-lg font-semibold">Items</h2>
        <div className="grid grid-cols-1 gap-3 p-5 md:grid-cols-[210px_1fr_130px]">
          <label className="text-sm text-gray-600">Warehouse<select className={`${inputClass} mt-1`} value={warehouseId} onChange={(event) => setWarehouseId(Number(event.target.value))}>{warehouseRows.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label>
          <label className="text-sm text-gray-600">Enter Item Name<div className="mt-1 flex"><select className={`${inputClass} rounded-r-none`} value={selectedItem} onChange={(event) => setSelectedItem(Number(event.target.value))}><option value={0}>Scan Barcode/Search Item/Brand Name</option>{items.data?.data?.content.map((item) => <option key={item.id} value={item.id}>{item.itemName}</option>)}</select><button type="button" onClick={addItem} className="flex h-10 w-11 items-center justify-center rounded-r border border-l-0 border-blue-400 text-blue-500"><CirclePlus size={18} /></button></div></label>
          <label className="text-sm text-gray-600">Purchased Items<button type="button" className={`${inputClass} mt-1 bg-white`}>Load</button></label>
        </div>
        <div className="overflow-x-auto px-5"><table className="w-full border-collapse text-sm"><thead><tr>{['ACTION', 'ITEM', 'MRP', 'QTY', 'UNIT', 'PRICE/UNIT', 'AMOUNT', 'DISCOUNT', 'TAX', 'TOTAL'].map((heading) => <th key={heading} className="border p-2 text-left">{heading}</th>)}</tr></thead><tbody>{lines.length ? lines.map((line, index) => <tr key={line.itemId}><td className="border p-2"><button onClick={() => setLines((current) => current.filter((_, i) => i !== index))} className="text-red-500"><Trash2 size={16} /></button></td><td className="border p-2">{line.itemName}</td><td className="border p-2">{line.rate.toFixed(2)}</td><td className="border p-2"><NumericInput min={0} value={line.quantity} onValueChange={(value) => update(index, 'quantity', value)} className="w-16 rounded border px-2 py-1" /></td><td className="border p-2">Nos</td><td className="border p-2"><NumericInput min={0} value={line.rate} onValueChange={(value) => update(index, 'rate', value)} className="w-20 rounded border px-2 py-1" /></td><td className="border p-2">{(line.quantity * line.rate).toFixed(2)}</td><td className="border p-2">0</td><td className="border p-2">0</td><td className="border p-2 font-semibold">{(line.quantity * line.rate).toFixed(2)}</td></tr>) : <tr><td colSpan={10} className="bg-gray-50 p-4 text-center italic">No items are added yet!!</td></tr>}<tr><td colSpan={3} className="border p-2 text-right font-bold">Total</td><td className="border p-2 font-bold">{lines.reduce((sum, line) => sum + line.quantity, 0)}</td><td colSpan={5} className="border p-2" /><td className="border p-2 text-right font-bold">{total.toFixed(2)}</td></tr></tbody></table></div>
        <div className="grid grid-cols-1 gap-5 p-5 md:grid-cols-[1fr_275px]"><label className="text-sm text-gray-600">Note<textarea className="mt-1 h-20 w-full rounded border border-gray-300 p-3" value={reason} onChange={(event) => setReason(event.target.value)} /></label><div className="space-y-2"><label className="flex items-center justify-between bg-gray-50 p-3 text-sm font-semibold"><span><input type="checkbox" checked={roundOff} onChange={(event) => setRoundOff(event.target.checked)} className="mr-2" />Round Off</span><input value={roundOff ? (grandTotal - total).toFixed(2) : '0'} readOnly className="w-28 rounded border border-gray-300 px-3 py-2 text-right" /></label><p className="flex items-center justify-between border-t p-3 text-sm font-bold"><span>Grand Total</span><input value={grandTotal.toFixed(2)} readOnly className="w-28 rounded border border-gray-300 px-3 py-2 text-right" /></p></div></div>
        <h2 className="border-y px-5 py-4 text-lg font-semibold">Payment</h2>
        <div className="grid grid-cols-1 gap-5 p-5 md:grid-cols-2"><label className="text-sm text-gray-600">#1 Amount<div className="mt-1 flex"><input className={`${inputClass} rounded-r-none text-right`} value={amount} onChange={(event) => setAmount(event.target.value)} /><span className="flex h-10 w-8 items-center justify-center rounded-r border border-l-0 border-gray-300">₹</span></div></label><label className="text-sm text-gray-600">Payment Type<div className="mt-1 flex"><select className={`${inputClass} rounded-r-none`} value={paymentType} onChange={(event) => setPaymentType(event.target.value)}><option value="">Choose one thing</option><option value="cash">Cash</option><option value="bank">Bank</option></select><button type="button" className="flex h-10 w-9 items-center justify-center rounded-r border border-l-0 border-gray-300 text-blue-500"><CirclePlus size={15} /></button></div></label><label className="text-sm text-gray-600">Payment Note<textarea className="mt-1 h-20 w-full rounded border border-gray-300 p-3" value={paymentNote} onChange={(event) => setPaymentNote(event.target.value)} /></label></div>
        <div className="px-5 pb-5"><button type="button" className="text-sm text-blue-600">+ Add Payment Type</button></div>
        <div className="flex gap-3 border-t p-5"><Button onClick={submit} isLoading={mutation.isPending}>Submit</Button><Button variant="secondary" onClick={() => navigate('/purchase/returns')}>Close</Button></div>
      </div>
    </div>
  );
};
