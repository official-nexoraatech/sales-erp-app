import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { customerApi, itemApi, warehouseApi } from '../../../api/endpoints';
import type { SaleRequest } from '../../../api/endpoints';
import { CountryStateSelect } from '../../../components/form/CountryStateSelect';
import { Button } from '../../../components/ui/Button';

interface Line {
  itemId: number;
  batchId: number;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  taxPercent: number;
  itemName: string;
}

interface Props {
  initial?: SaleRequest & { lines?: Line[] };
  submitText: string;
  loading: boolean;
  onSubmit: (payload: SaleRequest) => void;
  onCancel: () => void;
}

const inputClass = 'h-10 w-full rounded border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-gray-50';
const labelClass = 'block text-sm text-gray-600';
const tableInputClass = 'h-8 w-20 rounded border border-gray-300 px-2 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100';

export const SaleForm: React.FC<Props> = ({ initial, submitText, loading, onSubmit, onCancel }) => {
  const [customerId, setCustomerId] = useState(initial?.customerId || 0);
  const [invoiceDate, setInvoiceDate] = useState(initial?.invoiceDate || new Date().toISOString().slice(0, 10));
  const [warehouseId, setWarehouseId] = useState(initial?.warehouseId || 0);
  const [stateId, setStateId] = useState(initial?.stateId || 0);
  const [salesPersonId, setSalesPersonId] = useState(initial?.salesPersonId || 0);
  const [notes, setNotes] = useState(initial?.notes || '');
  const [lines, setLines] = useState<Line[]>(initial?.lines || []);
  const [selectedItem, setSelectedItem] = useState(0);

  const customers = useQuery({ queryKey: ['sale-form-customers'], queryFn: () => customerApi.getAll({ page: 0, size: 100, search: '' }) });
  const warehouses = useQuery({ queryKey: ['sale-form-warehouses'], queryFn: () => warehouseApi.getAll() });
  const items = useQuery({ queryKey: ['sale-form-items'], queryFn: () => itemApi.getAll({ page: 0, size: 100, search: '' }) });
  const warehouseRows = warehouses.data?.data || [];

  useEffect(() => {
    if (!warehouseId && warehouseRows.length) {
      setWarehouseId(warehouseRows[0].id);
    }
  }, [warehouseId, warehouseRows]);

  const add = () => {
    const item = items.data?.data?.content.find((entry) => entry.id === selectedItem);
    if (!item) return;

    setLines((current) => current.some((line) => line.itemId === item.id)
      ? current
      : [...current, {
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

  const submit = () => {
    if (!customerId || !warehouseId || !lines.length || lines.some((line) => !line.batchId || line.quantity <= 0)) {
      alert('Select customer, warehouse, items and valid batch IDs.');
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
        <h1 className="text-xl font-semibold text-gray-900">Sale Details</h1>
      </div>

      <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-3">
        <label className={labelClass}>Customer
          <select className={`${inputClass} mt-1`} value={customerId} onChange={(event) => setCustomerId(Number(event.target.value))}>
            <option value={0}>Walk in Customer (-)</option>
            {customers.data?.data?.content.map((customer) => <option key={customer.id} value={customer.id}>{customer.customerName}</option>)}
          </select>
        </label>

        <label className={labelClass}>Date
          <input type="date" className={`${inputClass} mt-1`} value={invoiceDate} onChange={(event) => setInvoiceDate(event.target.value)} />
        </label>

        <label className={labelClass}>Sale Code
          <input className={`${inputClass} mt-1 bg-gray-50`} value="SL/ Auto" readOnly />
        </label>

        <CountryStateSelect stateId={stateId} onStateChange={setStateId} className={inputClass} />

        <label className={labelClass}>Sales Person ID
          <input type="number" className={`${inputClass} mt-1`} placeholder="Sales Person ID" value={salesPersonId || ''} onChange={(event) => setSalesPersonId(Number(event.target.value))} />
        </label>
      </div>

      <h2 className="border-y px-5 py-4 text-lg font-semibold">Items</h2>
      <div className="grid grid-cols-1 gap-3 p-5 md:grid-cols-[220px_1fr_130px]">
        <label className={labelClass}>Warehouse
          <select className={`${inputClass} mt-1`} value={warehouseId} onChange={(event) => setWarehouseId(Number(event.target.value))}>
            {warehouseRows.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
          </select>
        </label>

        <label className={labelClass}>Item
          <select className={`${inputClass} mt-1`} value={selectedItem} onChange={(event) => setSelectedItem(Number(event.target.value))}>
            <option value={0}>Scan Barcode/Search Item/Brand Name</option>
            {items.data?.data?.content.map((item) => <option key={item.id} value={item.id}>{item.itemName}</option>)}
          </select>
        </label>

        <Button type="button" onClick={add} className="flex h-10 items-center justify-center gap-2 self-end">
          <Plus size={17} /> Add
        </Button>
      </div>

      <div className="overflow-x-auto px-5">
        <table className="w-full text-sm">
          <thead>
            <tr>
              {['Action', 'Item', 'Batch ID', 'Qty', 'Price/Unit', 'Discount %', 'Tax %', 'Total'].map((heading) => (
                <th key={heading} className="border p-2 text-left">{heading}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.length ? lines.map((line, index) => (
              <tr key={line.itemId}>
                <td className="border p-2">
                  <button type="button" onClick={() => setLines((current) => current.filter((_, i) => i !== index))} className="text-red-500">
                    <Trash2 size={16} />
                  </button>
                </td>
                <td className="border p-2">{line.itemName}</td>
                {(['batchId', 'quantity', 'unitPrice', 'discountPercent', 'taxPercent'] as const).map((field) => (
                  <td key={field} className="border p-2">
                    <input
                      type="number"
                      min="0"
                      value={line[field]}
                      onChange={(event) => update(index, field, Number(event.target.value))}
                      className={tableInputClass}
                    />
                  </td>
                ))}
                <td className="border p-2 font-semibold">{(line.quantity * line.unitPrice).toFixed(2)}</td>
              </tr>
            )) : (
              <tr>
                <td colSpan={8} className="bg-gray-50 p-4 text-center italic">No items are added yet!!</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-[1fr_280px]">
        <label className={labelClass}>Note
          <textarea className="mt-1 h-20 w-full rounded border border-gray-300 p-3 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100" value={notes} onChange={(event) => setNotes(event.target.value)} />
        </label>
        <div className="rounded bg-gray-50 p-4">
          <p className="flex justify-between font-bold">
            <span>Grand Total</span>
            <span>{total.toFixed(2)}</span>
          </p>
        </div>
      </div>

      <div className="flex gap-3 border-t p-5">
        <Button onClick={submit} isLoading={loading}>{submitText}</Button>
        <Button variant="secondary" onClick={onCancel}>Close</Button>
      </div>
    </div>
  );
};
