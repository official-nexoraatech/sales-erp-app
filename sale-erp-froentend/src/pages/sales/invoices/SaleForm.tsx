import React, { useEffect, useMemo, useState } from 'react';
import { CirclePlus, Trash2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { customerApi, itemApi, usersApi, warehouseApi } from '../../../api/endpoints';
import type { SaleRequest } from '../../../api/endpoints';
import { CountryStateSelect } from '../../../components/form/CountryStateSelect';
import { Button } from '../../../components/ui/Button';
import { NumericInput } from '../../../components/ui/NumericInput';

interface Line {
  itemId: number;
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
const loadButtonClass = 'mt-1 flex h-10 w-full items-center justify-center rounded border border-gray-300 bg-white px-3 text-sm font-medium text-blue-600 outline-none transition-colors hover:border-blue-400 hover:bg-blue-50 focus:border-blue-300 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-gray-50';
const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const lineTotal = (line: Line) => {
  const base = money(line.quantity * line.unitPrice);
  const discountAmount = money(base * line.discountPercent / 100);
  const taxableAmount = base - discountAmount;
  const taxAmount = money(taxableAmount * line.taxPercent / 100);
  return money(taxableAmount + taxAmount);
};

export const SaleForm: React.FC<Props> = ({ initial, submitText, loading, onSubmit, onCancel }) => {
  const navigate = useNavigate();
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
  const salesPersons = useQuery({ queryKey: ['sale-form-sales-persons'], queryFn: () => usersApi.getAll({ page: 0, size: 500, search: '' }) });
  const warehouseRows = warehouses.data?.data || [];
  const salesPersonRows = (salesPersons.data?.data?.content || []).filter((entry) =>
    entry.status !== false && entry.status !== 'INACTIVE'
  );

  useEffect(() => {
    if (!warehouseId && warehouseRows.length) {
      setWarehouseId(warehouseRows[0].id);
    }
  }, [warehouseId, warehouseRows]);

  const add = () => {
    const item = items.data?.data?.content.find((entry) => entry.id === selectedItem);
    if (!item) {
      toast.error('Select an item to load.');
      return;
    }

    setLines((current) => current.some((line) => line.itemId === item.id)
      ? current
      : [...current, {
        itemId: item.id,
        itemName: item.itemName,
        quantity: 1,
        unitPrice: item.salePrice,
        discountPercent: 0,
        taxPercent: 0,
      }]);
  };

  const update = (index: number, field: keyof Line, value: number) => {
    setLines((current) => current.map((line, i) => i === index ? { ...line, [field]: value } : line));
  };

  const total = useMemo(() => lines.reduce((sum, line) => sum + lineTotal(line), 0), [lines]);

  const submit = () => {
    if (!customerId || !warehouseId || !lines.length || lines.some((line) => line.quantity <= 0 || line.unitPrice <= 0)) {
      toast.error('Select customer, warehouse, items and valid quantities/prices.');
      return;
    }

    onSubmit({
      customerId,
      invoiceDate,
      warehouseId,
      stateId,
      salesPersonId,
      notes,
      items: lines.map(({ itemId, quantity, unitPrice, discountPercent, taxPercent }) => ({
        itemId,
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
            <option value={0}>Select Customer</option>
            {customers.data?.data?.content.map((customer) => <option key={customer.id} value={customer.id}>{customer.customerName}</option>)}
          </select>
        </label>

        <label className={labelClass}>Date
          <input type="date" className={`${inputClass} mt-1`} value={invoiceDate} onChange={(event) => setInvoiceDate(event.target.value)} />
        </label>

        <CountryStateSelect stateId={stateId} onStateChange={setStateId} className={inputClass} />

        <label className={labelClass}>Sales Person
          <select
            className={`${inputClass} mt-1`}
            value={salesPersonId}
            disabled={salesPersons.isLoading}
            onChange={(event) => setSalesPersonId(Number(event.target.value))}
          >
            <option value={0}>
              {salesPersons.isLoading ? 'Loading sales persons...' : 'Select sales person'}
            </option>
            {salesPersonRows.map((person) => {
              const fullName = `${person.firstName || ''} ${person.lastName || ''}`.trim();
              const userName = person.userName || person.username || '';
              return (
                <option key={person.id} value={person.id}>
                  {fullName || userName || `User ${person.id}`}
                  {fullName && userName ? ` (${userName})` : ''}
                </option>
              );
            })}
          </select>
        </label>
      </div>

      <h2 className="border-y px-5 py-4 text-lg font-semibold">Items</h2>
      <div className="grid grid-cols-1 gap-3 p-5 md:grid-cols-[210px_1fr_130px]">
        <label className={labelClass}>Warehouse
          <select className={`${inputClass} mt-1`} value={warehouseId} onChange={(event) => setWarehouseId(Number(event.target.value))}>
            {warehouseRows.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
          </select>
        </label>

        <label className={labelClass}>Enter Item Name
          <div className="mt-1 flex">
            <select className={`${inputClass} rounded-r-none`} value={selectedItem} onChange={(event) => setSelectedItem(Number(event.target.value))}>
              <option value={0}>Scan Barcode/Search Item/Brand Name</option>
              {items.data?.data?.content.map((item) => <option key={item.id} value={item.id}>{item.itemName}</option>)}
            </select>
            <button type="button" onClick={() => navigate('/items/create')} className="flex h-10 w-11 items-center justify-center rounded-r border border-l-0 border-blue-400 text-blue-500" title="Create item" aria-label="Create item"><CirclePlus size={18} /></button>
          </div>
        </label>

        <label className={labelClass}>Sold Items
          <button type="button" onClick={add} className={loadButtonClass}>Load</button>
        </label>
      </div>

      <div className="overflow-x-auto px-5">
        <table className="w-full text-sm">
          <thead>
            <tr>
              {['Action', 'Item', 'Qty', 'Price/Unit', 'Discount %', 'Tax %', 'Total'].map((heading) => (
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
                {(['quantity', 'unitPrice', 'discountPercent', 'taxPercent'] as const).map((field) => (
                  <td key={field} className="border p-2">
                    <NumericInput
                      min={0}
                      value={line[field]}
                      onValueChange={(value) => update(index, field, value)}
                      className={tableInputClass}
                    />
                  </td>
                ))}
                <td className="border p-2 font-semibold">{lineTotal(line).toFixed(2)}</td>
              </tr>
            )) : (
              <tr>
                <td colSpan={7} className="bg-gray-50 p-4 text-center italic">No items are added yet!!</td>
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
