import React, { useEffect, useMemo, useState } from 'react';
import { CirclePlus, Trash2, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { customerApi, itemApi, warehouseApi } from '../../../api/endpoints';
import type { SaleRequest } from '../../../api/endpoints';
import { CountryStateSelect } from '../../../components/form/CountryStateSelect';
import { Button } from '../../../components/ui/Button';

interface Line {
  itemId: number;
  batchId: number;
  itemName: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  taxPercent: number;
}

interface Props {
  initial?: SaleRequest & { lines?: Line[] };
  submitText: string;
  loading: boolean;
  onSubmit: (payload: SaleRequest) => void;
  onCancel: () => void;
}

const inputClass = 'h-10 w-full rounded border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-gray-50';

export const SaleOrderForm: React.FC<Props> = ({ initial, submitText, loading, onSubmit, onCancel }) => {
  const [customerId, setCustomerId] = useState(initial?.customerId || 0);
  const [invoiceDate, setInvoiceDate] = useState(initial?.invoiceDate || new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState('');
  const [warehouseId, setWarehouseId] = useState(initial?.warehouseId || 0);
  const [stateId, setStateId] = useState(initial?.stateId || 0);
  const [salesPersonId] = useState(initial?.salesPersonId || 0);
  const [orderStatus, setOrderStatus] = useState('PENDING');
  const [selectedItem, setSelectedItem] = useState(0);
  const [notes, setNotes] = useState(initial?.notes || '');
  const [roundOff, setRoundOff] = useState(false);
  const [amount, setAmount] = useState('');
  const [paymentType, setPaymentType] = useState('');
  const [paymentNote, setPaymentNote] = useState('');
  const [showItemModal, setShowItemModal] = useState(false);
  const [lines, setLines] = useState<Line[]>(initial?.lines || []);

  const customers = useQuery({ queryKey: ['sale-order-form-customers'], queryFn: () => customerApi.getAll({ page: 0, size: 100, search: '' }) });
  const warehouses = useQuery({ queryKey: ['sale-order-form-warehouses'], queryFn: () => warehouseApi.getAll() });
  const items = useQuery({ queryKey: ['sale-order-form-items'], queryFn: () => itemApi.getAll({ page: 0, size: 100, search: '' }) });
  const warehouseRows = warehouses.data?.data || [];

  useEffect(() => {
    if (!warehouseId && warehouseRows.length) {
      setWarehouseId(warehouseRows[0].id);
    }
  }, [warehouseId, warehouseRows]);

  const addItem = () => {
    const item = items.data?.data?.content.find((entry) => entry.id === selectedItem);
    if (!item) return;
    setLines((current) => current.some((line) => line.itemId === item.id) ? current : [...current, {
      itemId: item.id,
      itemName: item.itemName,
      batchId: 0,
      quantity: 1,
      unitPrice: item.salePrice,
      discountPercent: 0,
      taxPercent: 0,
    }]);
  };

  const update = (index: number, field: keyof Line, value: number) => {
    setLines((current) => current.map((line, i) => i === index ? { ...line, [field]: value } : line));
  };

  const total = useMemo(() => lines.reduce((sum, line) => {
    const base = line.quantity * line.unitPrice;
    return sum + base - base * line.discountPercent / 100 + base * line.taxPercent / 100;
  }, 0), [lines]);
  const grandTotal = roundOff ? Math.round(total) : total;
  const totalQuantity = lines.reduce((sum, line) => sum + line.quantity, 0);

  const submit = () => {
    if (!customerId || !warehouseId || !lines.length || lines.some((line) => line.quantity <= 0)) {
      alert('Select customer, warehouse, and at least one valid item.');
      return;
    }
    onSubmit({
      customerId,
      invoiceDate,
      warehouseId,
      stateId,
      salesPersonId,
      notes,
      items: lines.map(({ itemId, batchId, quantity, unitPrice, discountPercent, taxPercent }) => ({
        itemId,
        batchId,
        quantity,
        unitPrice,
        discountPercent,
        taxPercent,
      })),
    });
  };

  return (
    <div className="overflow-hidden rounded-lg bg-white shadow">
      <div className="border-b px-5 py-4">
        <h1 className="text-xl font-semibold text-gray-900">Sale Order Details</h1>
      </div>

      <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-3">
        <label className="text-sm text-gray-600">Customer
          <div className="mt-1 flex">
            <select className={`${inputClass} rounded-r-none`} value={customerId} onChange={(event) => setCustomerId(Number(event.target.value))}>
              <option value={0}>Walk in Customer (-)</option>
              {customers.data?.data?.content.map((customer) => <option key={customer.id} value={customer.id}>{customer.customerName}</option>)}
            </select>
            <button type="button" className="flex h-10 w-9 items-center justify-center border border-l-0 border-gray-300 text-gray-500"><X size={15} /></button>
            <button type="button" className="flex h-10 w-9 items-center justify-center rounded-r border border-l-0 border-gray-300 text-blue-500"><CirclePlus size={16} /></button>
          </div>
        </label>
        <label className="text-sm text-gray-600">Date
          <input type="date" className={`${inputClass} mt-1`} value={invoiceDate} onChange={(event) => setInvoiceDate(event.target.value)} />
        </label>
        <label className="text-sm text-gray-600">Due Date
          <input type="date" className={`${inputClass} mt-1`} value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
        </label>
        <label className="text-sm text-gray-600">Order ID
          <div className="mt-1 flex">
            <input className={`${inputClass} rounded-r-none`} value="SO/" readOnly />
            <span className="flex h-10 items-center border-y border-gray-300 px-3">#</span>
            <input className={`${inputClass} rounded-l-none`} value="1" readOnly />
          </div>
        </label>
        <CountryStateSelect stateId={stateId} onStateChange={setStateId} className={inputClass} />
        <label className="text-sm text-gray-600">Order Status
          <select className={`${inputClass} mt-1`} value={orderStatus} onChange={(event) => setOrderStatus(event.target.value)}>
            <option value="PENDING">Pending</option>
            <option value="APPROVED">Approved</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
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
              <option value={0}>Scan Barcode/Search Item/Brand Name</option>
              {items.data?.data?.content.map((item) => <option key={item.id} value={item.id}>{item.itemName}</option>)}
            </select>
            <button type="button" onClick={addItem} className="flex h-10 w-11 items-center justify-center border border-l-0 border-blue-400 text-blue-500"><CirclePlus size={18} /></button>
            <button type="button" onClick={() => setShowItemModal(true)} className="flex h-10 w-11 items-center justify-center rounded-r border border-l-0 border-blue-400 text-blue-500"><CirclePlus size={18} /></button>
          </div>
        </label>
        <label className="text-sm text-gray-600">Sold Items
          <button type="button" className={`${inputClass} mt-1 bg-white`}>Load</button>
        </label>
      </div>

      <div className="overflow-x-auto px-5">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>{['ACTION', 'ITEM', 'MRP', 'QTY', 'UNIT', 'PRICE/UNIT', 'AMOUNT', 'DISCOUNT', 'TAX', 'TOTAL'].map((heading) => <th key={heading} className="border p-2 text-left">{heading}</th>)}</tr>
          </thead>
          <tbody>
            {lines.length ? lines.map((line, index) => {
              const base = line.quantity * line.unitPrice;
              const rowTotal = base - base * line.discountPercent / 100 + base * line.taxPercent / 100;
              return (
                <tr key={line.itemId}>
                  <td className="border p-2"><button onClick={() => setLines((current) => current.filter((_, i) => i !== index))} className="text-red-500"><Trash2 size={16} /></button></td>
                  <td className="border p-2">{line.itemName}</td>
                  <td className="border p-2">{line.unitPrice.toFixed(2)}</td>
                  <td className="border p-2"><input type="number" value={line.quantity} onChange={(event) => update(index, 'quantity', Number(event.target.value))} className="w-16 rounded border px-2 py-1" /></td>
                  <td className="border p-2">Nos</td>
                  <td className="border p-2"><input type="number" value={line.unitPrice} onChange={(event) => update(index, 'unitPrice', Number(event.target.value))} className="w-20 rounded border px-2 py-1" /></td>
                  <td className="border p-2">{base.toFixed(2)}</td>
                  <td className="border p-2"><input type="number" value={line.discountPercent} onChange={(event) => update(index, 'discountPercent', Number(event.target.value))} className="w-16 rounded border px-2 py-1" /></td>
                  <td className="border p-2"><input type="number" value={line.taxPercent} onChange={(event) => update(index, 'taxPercent', Number(event.target.value))} className="w-16 rounded border px-2 py-1" /></td>
                  <td className="border p-2 font-semibold">{rowTotal.toFixed(2)}</td>
                </tr>
              );
            }) : <tr><td colSpan={10} className="bg-gray-50 p-4 text-center italic">No items are added yet!!</td></tr>}
            <tr>
              <td colSpan={3} className="border p-2 text-right font-bold">Total</td>
              <td className="border p-2 font-bold">{totalQuantity}</td>
              <td colSpan={5} className="border p-2" />
              <td className="border p-2 text-right font-bold">{total.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-1 gap-5 p-5 md:grid-cols-[1fr_275px]">
        <label className="text-sm text-gray-600">Note
          <textarea className="mt-1 h-20 w-full rounded border border-gray-300 p-3" value={notes} onChange={(event) => setNotes(event.target.value)} />
        </label>
        <div className="space-y-2">
          <label className="flex items-center justify-between bg-gray-50 p-3 text-sm font-semibold">
            <span><input type="checkbox" checked={roundOff} onChange={(event) => setRoundOff(event.target.checked)} className="mr-2" />Round Off</span>
            <input value={roundOff ? (grandTotal - total).toFixed(2) : '0'} readOnly className="w-28 rounded border border-gray-300 px-3 py-2 text-right" />
          </label>
          <p className="flex items-center justify-between border-t p-3 text-sm font-bold">
            <span>Grand Total</span>
            <input value={grandTotal.toFixed(2)} readOnly className="w-28 rounded border border-gray-300 px-3 py-2 text-right" />
          </p>
        </div>
      </div>

      <h2 className="border-y px-5 py-4 text-lg font-semibold">Payment</h2>
      <div className="grid grid-cols-1 gap-5 p-5 md:grid-cols-2">
        <label className="text-sm text-gray-600">#1 Amount
          <div className="mt-1 flex">
            <input className={`${inputClass} rounded-r-none text-right`} value={amount} onChange={(event) => setAmount(event.target.value)} />
            <span className="flex h-10 w-8 items-center justify-center rounded-r border border-l-0 border-gray-300">₹</span>
          </div>
        </label>
        <label className="text-sm text-gray-600">Payment Type
          <div className="mt-1 flex">
            <select className={`${inputClass} rounded-r-none`} value={paymentType} onChange={(event) => setPaymentType(event.target.value)}>
              <option value="">Choose one thing</option>
              <option value="cash">Cash</option>
              <option value="bank">Bank</option>
            </select>
            <button type="button" className="flex h-10 w-9 items-center justify-center rounded-r border border-l-0 border-gray-300 text-blue-500"><CirclePlus size={15} /></button>
          </div>
        </label>
        <label className="text-sm text-gray-600">Payment Note
          <textarea className="mt-1 h-20 w-full rounded border border-gray-300 p-3" value={paymentNote} onChange={(event) => setPaymentNote(event.target.value)} />
        </label>
      </div>
      <div className="px-5 pb-5">
        <button type="button" className="text-sm text-blue-600">+ Add Payment Type</button>
      </div>

      <div className="flex gap-3 border-t p-5">
        <Button onClick={submit} isLoading={loading}>{submitText}</Button>
        <Button variant="secondary" onClick={onCancel}>Close</Button>
      </div>

      {showItemModal && <CreateItemModal onClose={() => setShowItemModal(false)} />}
    </div>
  );
};

const CreateItemModal: React.FC<{ onClose: () => void }> = ({ onClose }) => (
  <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 p-6">
    <div className="my-4 w-full max-w-5xl overflow-hidden rounded-lg bg-white shadow-xl">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-lg font-semibold">Create Item</h2>
        <button type="button" onClick={onClose} className="text-gray-500"><X size={20} /></button>
      </div>
      <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2">
        <label className="text-sm text-gray-600">Name<input className={`${inputClass} mt-1`} /></label>
        <label className="text-sm text-gray-600">Item Type<select className={`${inputClass} mt-1`} defaultValue="Product"><option>Product</option><option>Service</option></select></label>
        <label className="text-sm text-gray-600">HSN<input className={`${inputClass} mt-1`} /></label>
        <label className="text-sm text-gray-600">SKU<input className={`${inputClass} mt-1`} /></label>
        <label className="text-sm text-gray-600">Item Code<div className="mt-1 flex"><input className={`${inputClass} rounded-r-none`} /><button type="button" className="h-10 rounded-r border border-l-0 px-3 text-gray-600">Auto</button></div></label>
        <label className="text-sm text-gray-600">Brand<select className={`${inputClass} mt-1`}><option>Choose one thing</option></select></label>
        <label className="text-sm text-gray-600">Category<select className={`${inputClass} mt-1`} defaultValue="General"><option>General</option></select></label>
        <label className="text-sm text-gray-600">Description<textarea className="mt-1 h-16 w-full rounded border border-gray-300 p-3" /></label>
      </div>
      <div className="grid grid-cols-1 gap-4 border-t p-4 md:grid-cols-3">
        <label className="text-sm text-gray-600">Base Unit<select className={`${inputClass} mt-1`}><option>None(None)</option></select></label>
        <label className="text-sm text-gray-600">Secondary Unit<select className={`${inputClass} mt-1`}><option>None(None)</option></select></label>
        <label className="text-sm text-gray-600">Conversion Rate<input className={`${inputClass} mt-1`} defaultValue="1" /></label>
      </div>
      <div className="border-t p-4">
        <label className="inline-flex items-center gap-2 text-sm font-semibold text-gray-700"><input type="radio" defaultChecked />Regular</label>
      </div>
      <div className="grid grid-cols-1 gap-4 border-t p-4 md:grid-cols-3">
        <label className="text-sm text-gray-600">Batch<input className={`${inputClass} mt-1`} /></label>
        <label className="text-sm text-gray-600">Mfg.Date<input type="date" className={`${inputClass} mt-1`} defaultValue={new Date().toISOString().slice(0, 10)} /></label>
        <label className="text-sm text-gray-600">Exp.Date<input type="date" className={`${inputClass} mt-1`} defaultValue={new Date().toISOString().slice(0, 10)} /></label>
      </div>
      <div className="flex justify-end gap-2 border-t p-4">
        <Button variant="secondary" onClick={onClose}>Close</Button>
        <Button onClick={onClose}>Submit</Button>
      </div>
    </div>
  </div>
);
