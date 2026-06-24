import React, { useEffect, useMemo, useState } from 'react';
import { CirclePlus, Trash2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { carrierApi, itemApi, paymentMethodApi, supplierApi, warehouseApi } from '../../../api/endpoints';
import type { PurchaseRequest } from '../../../api/endpoints';
import { CountryStateSelect } from '../../../components/form/CountryStateSelect';
import { Button } from '../../../components/ui/Button';
import { NumericInput } from '../../../components/ui/NumericInput';

interface Line {
  itemId: number;
  itemName: string;
  batchNo: string;
  manufacturingDate: string;
  expiryDate: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  taxPercent: number;
}

export type PurchaseSubmitPayload = PurchaseRequest & {
  paymentAmount?: number;
  paymentMethodId?: number;
  paymentNote?: string;
};

interface Props {
  initial?: PurchaseRequest & { lines?: Line[] };
  submitText: string;
  loading: boolean;
  onSubmit: (payload: PurchaseSubmitPayload) => void;
  onCancel: () => void;
  mode?: 'bill' | 'order';
}

const inputClass = 'h-10 w-full rounded border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-gray-50';

export const PurchaseForm: React.FC<Props> = ({ initial, submitText, loading, onSubmit, onCancel, mode = 'bill' }) => {
  const navigate = useNavigate();
  const isOrder = mode === 'order';
  const today = new Date().toISOString().slice(0, 10);
  const [supplierId, setSupplierId] = useState(initial?.supplierId || 0);
  const [purchaseDate, setPurchaseDate] = useState(initial?.purchaseDate || today);
  const [referenceNo, setReferenceNo] = useState(initial?.referenceNo || '');
  const [warehouseId, setWarehouseId] = useState(initial?.warehouseId || 0);
  const [carrierId, setCarrierId] = useState(initial?.carrierId || 0);
  const [stateId, setStateId] = useState(initial?.stateId || 0);
  const [selectedItem, setSelectedItem] = useState(0);
  const [notes, setNotes] = useState(initial?.notes || '');
  const [roundOff, setRoundOff] = useState(false);
  const [amount, setAmount] = useState(0);
  const [paymentMethodId, setPaymentMethodId] = useState(0);
  const [paymentNote, setPaymentNote] = useState('');
  const [lines, setLines] = useState<Line[]>(initial?.lines || []);

  const suppliers = useQuery({ queryKey: ['purchase-form-suppliers'], queryFn: () => supplierApi.getAll({ page: 0, size: 100, search: '' }) });
  const warehouses = useQuery({ queryKey: ['purchase-form-warehouses'], queryFn: () => warehouseApi.getAll() });
  const carriers = useQuery({ queryKey: ['purchase-form-carriers'], queryFn: () => carrierApi.getAll({ page: 0, size: 100, search: '' }), retry: false });
  const items = useQuery({ queryKey: ['purchase-form-items'], queryFn: () => itemApi.getAll({ page: 0, size: 100, search: '' }) });
  const paymentMethods = useQuery({ queryKey: ['purchase-form-payment-methods'], queryFn: () => paymentMethodApi.getAll('') });
  const warehouseRows = warehouses.data?.data || [];
  const paymentMethodRows = (paymentMethods.data?.data?.content || [])
    .filter((method) => method.status === 'ACTIVE' || method.id === paymentMethodId);

  useEffect(() => {
    if (!warehouseId && warehouseRows.length) {
      setWarehouseId(warehouseRows[0].id);
    }
  }, [warehouseId, warehouseRows]);

  const addItem = () => {
    const item = items.data?.data?.content.find((entry) => entry.id === selectedItem);
    if (!item) {
      toast.error('Select an item to load.');
      return;
    }
    setLines((current) => current.some((line) => line.itemId === item.id) ? current : [...current, {
      itemId: item.id,
      itemName: item.itemName,
      batchNo: '',
      manufacturingDate: today,
      expiryDate: today,
      quantity: 1,
      unitPrice: item.purchasePrice || item.salePrice,
      discountPercent: 0,
      taxPercent: 0,
    }]);
  };

  const updateNumber = (index: number, field: keyof Pick<Line, 'quantity' | 'unitPrice' | 'discountPercent' | 'taxPercent'>, value: number) => {
    setLines((current) => current.map((line, i) => i === index ? { ...line, [field]: value } : line));
  };

  const total = useMemo(() => lines.reduce((sum, line) => {
    const base = line.quantity * line.unitPrice;
    return sum + base - base * line.discountPercent / 100 + base * line.taxPercent / 100;
  }, 0), [lines]);
  const grandTotal = roundOff ? Math.round(total) : total;
  const totalQuantity = lines.reduce((sum, line) => sum + line.quantity, 0);

  const submit = () => {
    if (!supplierId || !warehouseId || !lines.length || lines.some((line) => line.quantity <= 0)) {
      toast.error('Select supplier, warehouse, and at least one valid item.');
      return;
    }
    if (amount > 0 && !paymentMethodId) {
      toast.error('Select payment type for the entered payment amount.');
      return;
    }
    onSubmit({
      supplierId,
      purchaseDate,
      referenceNo,
      warehouseId,
      carrierId,
      stateId,
      notes,
      items: lines.map(({ itemId, batchNo, manufacturingDate, expiryDate, quantity, unitPrice, discountPercent, taxPercent }) => ({
        itemId,
        batchNo: batchNo || 'BATCH',
        manufacturingDate,
        expiryDate,
        quantity,
        unitPrice,
        discountPercent,
        taxPercent,
      })),
      paymentAmount: amount,
      paymentMethodId,
      paymentNote,
    });
  };

  return (
    <div className="overflow-hidden rounded-lg bg-white shadow">
      <div className="border-b px-5 py-4"><h1 className="text-xl font-semibold text-gray-900">{isOrder ? 'Purchase Order Details' : 'Purchase Details'}</h1></div>

      <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-3">
        <label className="text-sm text-gray-600">Supplier
          <div className="mt-1 flex">
            <select className={`${inputClass} rounded-r-none`} value={supplierId} onChange={(event) => setSupplierId(Number(event.target.value))}>
              <option value={0}>Select Supplier</option>
              {suppliers.data?.data?.content.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.supplierName}</option>)}
            </select>
            <button type="button" onClick={() => navigate('/contacts/suppliers/create')} className="flex h-10 w-9 items-center justify-center rounded-r border border-l-0 border-gray-300 text-blue-500" title="Create supplier" aria-label="Create supplier"><CirclePlus size={16} /></button>
          </div>
        </label>
        <label className="text-sm text-gray-600">Date
          <input type="date" className={`${inputClass} mt-1`} value={purchaseDate} onChange={(event) => setPurchaseDate(event.target.value)} />
        </label>
        <label className="text-sm text-gray-600">{isOrder ? 'Due Date' : 'Purchase Code'}
          {isOrder ? <input type="date" className={`${inputClass} mt-1`} defaultValue={purchaseDate} /> : <div className="mt-1 flex"><input className={`${inputClass} rounded-r-none`} value="PB/" readOnly /><span className="flex h-10 items-center border-y border-gray-300 px-3">#</span><input className={`${inputClass} rounded-l-none`} value="3" readOnly /></div>}
        </label>
        <label className="text-sm text-gray-600">{isOrder ? 'Order ID' : 'Ref No.'}
          {isOrder ? <div className="mt-1 flex"><input className={`${inputClass} rounded-r-none`} value="PO/" readOnly /><span className="flex h-10 items-center border-y border-gray-300 px-3">#</span><input className={`${inputClass} rounded-l-none`} value="3" readOnly /></div> : <input className={`${inputClass} mt-1`} placeholder="(Optional)" value={referenceNo} onChange={(event) => setReferenceNo(event.target.value)} />}
        </label>
        <CountryStateSelect stateId={stateId} onStateChange={setStateId} className={inputClass} />
        <label className="text-sm text-gray-600">{isOrder ? 'Order Status' : 'Shipping Carrier'}
          {isOrder ? <select className={`${inputClass} mt-1`} defaultValue="PENDING"><option value="PENDING">Pending</option><option value="APPROVED">Approved</option><option value="CANCELLED">Cancelled</option></select> : <select className={`${inputClass} mt-1`} value={carrierId} onChange={(event) => setCarrierId(Number(event.target.value))}><option value={0}>Choose one thing</option>{carriers.data?.data?.content.map((carrier) => <option key={carrier.id} value={carrier.id}>{carrier.name}</option>)}</select>}
        </label>
      </div>

      <h2 className="border-y px-5 py-4 text-lg font-semibold">Items</h2>
      <div className="grid grid-cols-1 gap-3 p-5 md:grid-cols-[210px_1fr_130px]">
        <label className="text-sm text-gray-600">Warehouse
          <select className={`${inputClass} mt-1`} value={warehouseId} onChange={(event) => setWarehouseId(Number(event.target.value))}>
            {warehouseRows.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
          </select>
        </label>
        <label className="text-sm text-gray-600">Enter Item Name
          <div className="mt-1 flex">
            <select className={`${inputClass} rounded-r-none`} value={selectedItem} onChange={(event) => setSelectedItem(Number(event.target.value))}>
              <option value={0}>Search Item/Brand Name</option>
              {items.data?.data?.content.map((item) => <option key={item.id} value={item.id}>{item.itemName}</option>)}
            </select>
            <button type="button" onClick={() => navigate('/items/create')} className="flex h-10 w-11 items-center justify-center rounded-r border border-l-0 border-blue-400 text-blue-500" title="Create item" aria-label="Create item"><CirclePlus size={18} /></button>
          </div>
        </label>
        <label className="text-sm text-gray-600">Purchased Items
          <button type="button" onClick={addItem} className={`${inputClass} mt-1 bg-white`}>Load</button>
        </label>
      </div>

      <div className="overflow-x-auto px-5">
        <table className="w-full border-collapse text-sm">
          <thead><tr>{['ACTION', 'ITEM', 'MRP', 'QTY', 'UNIT', 'PRICE/UNIT', 'AMOUNT', 'DISCOUNT', 'TAX', 'TOTAL'].map((heading) => <th key={heading} className="border p-2 text-left">{heading}</th>)}</tr></thead>
          <tbody>
            {lines.length ? lines.map((line, index) => {
              const base = line.quantity * line.unitPrice;
              const rowTotal = base - base * line.discountPercent / 100 + base * line.taxPercent / 100;
              return (
                <tr key={line.itemId}>
                  <td className="border p-2"><button onClick={() => setLines((current) => current.filter((_, i) => i !== index))} className="text-red-500" title="Remove item"><Trash2 size={16} /></button></td>
                  <td className="border p-2">{line.itemName}</td>
                  <td className="border p-2">{line.unitPrice.toFixed(2)}</td>
                  <td className="border p-2"><NumericInput min={0} value={line.quantity} onValueChange={(value) => updateNumber(index, 'quantity', value)} className="w-16 rounded border px-2 py-1" /></td>
                  <td className="border p-2">Nos</td>
                  <td className="border p-2"><NumericInput min={0} value={line.unitPrice} onValueChange={(value) => updateNumber(index, 'unitPrice', value)} className="w-20 rounded border px-2 py-1" /></td>
                  <td className="border p-2">{base.toFixed(2)}</td>
                  <td className="border p-2"><NumericInput min={0} value={line.discountPercent} onValueChange={(value) => updateNumber(index, 'discountPercent', value)} className="w-16 rounded border px-2 py-1" /></td>
                  <td className="border p-2"><NumericInput min={0} value={line.taxPercent} onValueChange={(value) => updateNumber(index, 'taxPercent', value)} className="w-16 rounded border px-2 py-1" /></td>
                  <td className="border p-2 font-semibold">{rowTotal.toFixed(2)}</td>
                </tr>
              );
            }) : <tr><td colSpan={10} className="bg-gray-50 p-4 text-center italic">No items are added yet!!</td></tr>}
            <tr><td colSpan={3} className="border p-2 text-right font-bold">Total</td><td className="border p-2 font-bold">{totalQuantity}</td><td colSpan={5} className="border p-2" /><td className="border p-2 text-right font-bold">{total.toFixed(2)}</td></tr>
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-1 gap-5 p-5 md:grid-cols-[1fr_275px]">
        <label className="text-sm text-gray-600">Note
          <textarea className="mt-1 h-20 w-full rounded border border-gray-300 p-3" value={notes} onChange={(event) => setNotes(event.target.value)} />
        </label>
        <div className="space-y-2">
          <label className="flex items-center justify-between bg-gray-50 p-3 text-sm font-semibold"><span><input type="checkbox" checked={roundOff} onChange={(event) => setRoundOff(event.target.checked)} className="mr-2" />Round Off</span><input value={roundOff ? (grandTotal - total).toFixed(2) : '0'} readOnly className="w-28 rounded border border-gray-300 px-3 py-2 text-right" /></label>
          <p className="flex items-center justify-between border-t p-3 text-sm font-bold"><span>Grand Total</span><input value={grandTotal.toFixed(2)} readOnly className="w-28 rounded border border-gray-300 px-3 py-2 text-right" /></p>
        </div>
      </div>

      <h2 className="border-y px-5 py-4 text-lg font-semibold">Payment</h2>
      <div className="grid grid-cols-1 gap-5 p-5 md:grid-cols-2">
        <label className="text-sm text-gray-600">#1 Amount<div className="mt-1 flex"><NumericInput min={0} className={`${inputClass} rounded-r-none text-right`} value={amount || ''} onValueChange={setAmount} /><span className="flex h-10 w-10 items-center justify-center rounded-r border border-l-0 border-gray-300">Rs.</span></div></label>
        <label className="text-sm text-gray-600">Payment Type<div className="mt-1 flex"><select className={`${inputClass} rounded-r-none`} value={paymentMethodId} disabled={paymentMethods.isLoading || paymentMethods.isError} onChange={(event) => setPaymentMethodId(Number(event.target.value))}><option value={0}>{paymentMethods.isLoading ? 'Loading payment types...' : paymentMethods.isError ? 'Failed to load payment types' : 'Choose one thing'}</option>{paymentMethodRows.map((method) => <option key={method.id} value={method.id}>{method.name}</option>)}</select><button type="button" title="Create payment type" aria-label="Create payment type" onClick={() => navigate('/expenses/payment-types/create')} className="flex h-10 w-9 items-center justify-center rounded-r border border-l-0 border-gray-300 text-blue-500"><CirclePlus size={15} /></button></div></label>
        <label className="text-sm text-gray-600">Payment Note<textarea className="mt-1 h-20 w-full rounded border border-gray-300 p-3" value={paymentNote} onChange={(event) => setPaymentNote(event.target.value)} /></label>
      </div>
      <div className="px-5 pb-5"><button type="button" onClick={() => navigate('/expenses/payment-types/create')} className="text-sm text-blue-600">+ Add Payment Type</button></div>

      <div className="flex gap-3 border-t p-5">
        <Button onClick={submit} isLoading={loading}>{submitText}</Button>
        <Button variant="secondary" onClick={onCancel}>Close</Button>
      </div>
    </div>
  );
};
