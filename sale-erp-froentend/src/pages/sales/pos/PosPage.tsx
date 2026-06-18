import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Box, CalendarDays, CirclePlus, CreditCard, LayoutDashboard, Minus, PackageSearch, Plus, Trash2, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { customerApi, itemApi, posApi, warehouseApi } from '../../../api/endpoints';
import type { ItemListItem } from '../../../api/endpoints';
import { useDebounce } from '../../../hooks/useDebounce';

interface CartLine extends ItemListItem { quantity: number }

const controlClass = 'h-10 w-full rounded border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100';
const fieldLabelClass = 'text-sm font-medium text-slate-600';

const parseScannedItemId = (value: string) => {
  const scannedValue = value.trim();
  if (!/^\d+$/.test(scannedValue)) return null;
  return Number(scannedValue);
};

const formatValue = (value: string | number | null | undefined) => {
  if (value === null || value === undefined || value === '') return '-';
  return String(value);
};

const formatNumber = (value: number | null | undefined, digits = 2) => {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue.toFixed(digits) : '-';
};

const formatNameWithId = (name?: string | null, id?: number | null) => {
  const label = formatValue(name);
  return id ? `${label} (ID: ${id})` : label;
};

const getItemStatusLabel = (status: ItemListItem['status']) => {
  if (typeof status === 'boolean') return status ? 'ACTIVE' : 'INACTIVE';
  return formatValue(status).toUpperCase();
};

const isItemActive = (item: ItemListItem) => getItemStatusLabel(item.status) === 'ACTIVE';

export const PosPage: React.FC = () => {
  const navigate = useNavigate();
  const [customerId, setCustomerId] = useState(0);
  const [warehouseId, setWarehouseId] = useState(0);
  const [paymentMethodId, setPaymentMethodId] = useState(0);
  const [customerSearch, setCustomerSearch] = useState('');
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [roundOff, setRoundOff] = useState(false);
  const scannerInputRef = useRef<HTMLInputElement | null>(null);
  const scannerBufferRef = useRef('');
  const scannerFirstKeyAtRef = useRef(0);
  const scannerLastKeyAtRef = useRef(0);
  const scannerTimerRef = useRef<number | null>(null);
  const lastSubmittedScanRef = useRef<{ value: string; at: number }>({ value: '', at: 0 });
  const debouncedCustomerSearch = useDebounce(customerSearch);

  const customers = useQuery({ queryKey: ['pos-customers', debouncedCustomerSearch], queryFn: () => customerApi.getAll({ page: 0, size: 100, search: debouncedCustomerSearch }) });
  const warehouses = useQuery({ queryKey: ['pos-warehouses'], queryFn: () => warehouseApi.getAll() });
  const warehouseRows = warehouses.data?.data || [];

  useEffect(() => {
    if (!warehouseId && warehouseRows.length) {
      setWarehouseId(warehouseRows[0].id);
    }
  }, [warehouseId, warehouseRows]);

  const addItem = useCallback((item: ItemListItem) => setCart((current) => {
    const availableQty = Number(item.availableQty ?? 0);
    const existing = current.find((line) => line.id === item.id);
    if (existing) return current.map((line) => line.id === item.id ? { ...line, quantity: Math.min(line.quantity + 1, availableQty) } : line);
    return [...current, { ...item, availableQty, quantity: 1 }];
  }), []);
  const updateQuantity = (id: number, quantity: number) => setCart((current) => current.map((line) => line.id === id ? { ...line, quantity: Math.max(1, Math.min(quantity, line.availableQty)) } : line));
  const totalQuantity = useMemo(() => cart.reduce((sum, line) => sum + line.quantity, 0), [cart]);
  const total = useMemo(() => cart.reduce((sum, line) => sum + Number(line.salePrice || 0) * line.quantity, 0), [cart]);
  const grandTotal = roundOff ? Math.round(total) : total;

  const billing = useMutation({
    mutationFn: () => posApi.createBill({ customerId, warehouseId, paymentMethodId, items: cart.map((line) => ({ itemId: line.id, quantity: line.quantity })) }),
    onSuccess: () => { toast.success('POS bill created successfully'); setCart([]); },
    onError: (error: any) => toast.error(error?.message || 'Failed to create POS bill'),
  });
  const scanItem = useMutation({
    mutationFn: async (rawValue: string): Promise<ItemListItem | null> => {
      const scannedValue = rawValue.trim();
      const itemId = parseScannedItemId(scannedValue);
      if (itemId) {
        console.log('[POS Scanner] Calling get item API:', `/api/v1/items/${itemId}`);
        const response = await itemApi.getById(itemId);
        return response.data || null;
      }

      console.log('[POS Scanner] Non-numeric barcode. Searching items by value:', scannedValue);
      const response = await itemApi.getAll({ page: 0, size: 5, search: scannedValue });
      const results = response.data?.content || [];
      const exactMatch = results.find((item) =>
        String(item.barcode || '') === scannedValue ||
        String(item.itemCode || '') === scannedValue ||
        String(item.sku || '') === scannedValue
      );
      const matchedItem = exactMatch || results[0] || null;
      if (!matchedItem) return null;
      console.log('[POS Scanner] Calling get item API:', `/api/v1/items/${matchedItem.id}`);
      const itemResponse = await itemApi.getById(matchedItem.id);
      return itemResponse.data || matchedItem;
    },
    onSuccess: (item) => {
      console.log('[POS Scanner] Item lookup success:', item);
      if (!item) {
        toast.error('No item found for this barcode');
        return;
      }
      if (!isItemActive(item)) {
        toast.error(`${item.itemName} is inactive`);
        return;
      }
      if (Number(item.availableQty ?? 0) <= 0) {
        toast.error(`${item.itemName} is out of stock`);
        return;
      }
      addItem(item);
      setSearch('');
      toast.success(`${item.itemName} added`);
    },
    onError: (error: any) => {
      console.error('[POS Scanner] Get item API failed:', error);
      toast.error(error?.message || 'No item found for this barcode');
    },
  });
  const scanAndAddItem = useCallback((rawValue = search, source = 'manual') => {
    const scannedValue = rawValue.trim();
    console.log(`[POS Scanner] Raw barcode value read (${source}):`, scannedValue);
    if (!scannedValue) {
      console.warn('[POS Scanner] Empty barcode scan ignored');
      return;
    }

    const now = Date.now();
    if (lastSubmittedScanRef.current.value === scannedValue && now - lastSubmittedScanRef.current.at < 500) {
      console.log('[POS Scanner] Duplicate scan ignored:', scannedValue);
      return;
    }
    lastSubmittedScanRef.current = { value: scannedValue, at: now };

    const itemId = parseScannedItemId(scannedValue);
    if (itemId) {
      console.log('[POS Scanner] Parsed numeric item ID:', itemId);
    } else {
      console.log('[POS Scanner] Barcode is not numeric. Will search by barcode/item code/SKU:', scannedValue);
    }
    setSearch(scannedValue);
    scanItem.mutate(scannedValue);
  }, [scanItem, search]);

  useEffect(() => {
    const resetScannerBuffer = () => {
      scannerBufferRef.current = '';
      scannerFirstKeyAtRef.current = 0;
      scannerLastKeyAtRef.current = 0;
      if (scannerTimerRef.current) {
        window.clearTimeout(scannerTimerRef.current);
        scannerTimerRef.current = null;
      }
    };

    const flushScannerBuffer = (source: string) => {
      const bufferedValue = scannerBufferRef.current.trim();
      resetScannerBuffer();
      if (bufferedValue) {
        scanAndAddItem(bufferedValue, source);
      }
    };

    const handleGlobalScannerKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      const activeElement = document.activeElement as HTMLElement | null;
      const activeTag = activeElement?.tagName.toLowerCase();
      const isEditable = activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select' || Boolean(activeElement?.isContentEditable);
      const isScannerInput = activeElement === scannerInputRef.current;
      if (isEditable && !isScannerInput) return;

      if (event.key === 'Enter' || event.key === 'Tab') {
        if (scannerBufferRef.current) {
          event.preventDefault();
          console.log(`[POS Scanner] Scanner suffix received: ${event.key}`);
          flushScannerBuffer(`keyboard-${event.key.toLowerCase()}`);
        }
        return;
      }

      if (event.key.length !== 1) return;

      const now = Date.now();
      const gap = scannerLastKeyAtRef.current ? now - scannerLastKeyAtRef.current : 0;
      if (!scannerFirstKeyAtRef.current || gap > 120) {
        scannerBufferRef.current = '';
        scannerFirstKeyAtRef.current = now;
      }

      scannerBufferRef.current += event.key;
      scannerLastKeyAtRef.current = now;
      console.log('[POS Scanner] Keyboard scanner key:', event.key, 'buffer:', scannerBufferRef.current);

      if (scannerTimerRef.current) window.clearTimeout(scannerTimerRef.current);
      scannerTimerRef.current = window.setTimeout(() => {
        const duration = Date.now() - scannerFirstKeyAtRef.current;
        const bufferedValue = scannerBufferRef.current;
        if (bufferedValue.length >= 1 && duration < 1000) {
          console.log('[POS Scanner] Scanner timeout flush:', bufferedValue);
          flushScannerBuffer('keyboard-timeout');
        } else if (bufferedValue) {
          console.log('[POS Scanner] Buffered keyboard input was not auto-submitted:', bufferedValue);
          resetScannerBuffer();
        }
      }, 220);
    };

    window.addEventListener('keydown', handleGlobalScannerKey);
    return () => {
      window.removeEventListener('keydown', handleGlobalScannerKey);
      resetScannerBuffer();
    };
  }, [scanAndAddItem]);

  const handleScanKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    scanAndAddItem(search, 'input-enter');
  };
  const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    console.log('[POS Scanner] POS scan/search input changed:', value);
    setSearch(value);
  };
  const handleScanPaste = (event: React.ClipboardEvent<HTMLInputElement>) => {
    const value = event.clipboardData.getData('text');
    console.log('[POS Scanner] Paste/scanner value received:', value);
    if (value.trim()) {
      window.setTimeout(() => scanAndAddItem(value, 'input-paste'), 0);
    }
  };
  const save = () => {
    if (!customerId) return toast.error('Please select a customer');
    if (!warehouseId) return toast.error('Please select a warehouse');
    if (!paymentMethodId) return toast.error('Please enter a payment method ID');
    if (!cart.length) return toast.error('Please add at least one item');
    billing.mutate();
  };

  return (
    <div className="min-h-screen bg-[#f5f6ff] text-slate-700">
      <header className="flex h-12 items-center justify-between border-b bg-white px-3 shadow-sm">
        <button onClick={() => navigate('/dashboard')} className="text-xl font-semibold text-blue-600">BillTop</button>
        <nav className="hidden items-center gap-5 text-xs text-slate-600 md:flex">
          <button onClick={() => navigate('/dashboard')} className="flex items-center gap-1 hover:text-blue-600"><LayoutDashboard size={13} />Dashboard</button>
          <button onClick={() => navigate('/contacts/customers')} className="flex items-center gap-1 hover:text-blue-600"><Users size={13} />Customer List</button>
          <button className="flex items-center gap-1"><CreditCard size={13} />Invoices</button>
          <button className="flex items-center gap-1"><Box size={13} />Item List</button>
          <button className="flex items-center gap-1"><CreditCard size={13} />Payment In</button>
        </nav>
      </header>

      <main className="pb-16">
        <div className="grid grid-cols-1 gap-3 border-b p-3 md:grid-cols-2 xl:grid-cols-4">
          <label className={fieldLabelClass}>Date
            <div className="relative mt-1">
              <input type="date" className={controlClass} defaultValue={new Date().toISOString().slice(0, 10)} />
              <CalendarDays className="pointer-events-none absolute right-3 top-3 text-slate-500" size={15} />
            </div>
          </label>
          <label className={fieldLabelClass}>Warehouse
            <select className={`${controlClass} mt-1`} value={warehouseId} onChange={(event) => setWarehouseId(Number(event.target.value))}>
              {warehouseRows.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
            </select>
          </label>
          <label className={fieldLabelClass}>Sale Type
            <select className={`${controlClass} mt-1`}><option>Choose one thing</option></select>
          </label>
          <label className={fieldLabelClass}>Price List
            <select className={`${controlClass} mt-1`}><option>Choose one thing</option></select>
          </label>
          <div className={fieldLabelClass}>
            <span>Invoice ID</span>
            <div className="mt-1 flex">
              <input value="SL/" readOnly className={`${controlClass} rounded-r-none`} />
              <span className="flex h-10 items-center border-y border-slate-200 bg-white px-3">#</span>
              <input value="7" readOnly className={`${controlClass} rounded-l-none`} />
            </div>
          </div>
          <label className={fieldLabelClass}>Payment Method ID
            <input type="number" min="1" className={`${controlClass} mt-1`} value={paymentMethodId || ''} onChange={(event) => setPaymentMethodId(Number(event.target.value))} placeholder="Payment ID" />
          </label>
          <div className={fieldLabelClass}>
            <span>Customer</span>
            <input className={`${controlClass} mt-1`} value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} placeholder="Search customer" />
            <div className="mt-2 flex">
              <select className={`${controlClass} rounded-r-none`} value={customerId} onChange={(event) => setCustomerId(Number(event.target.value))}>
                <option value={0}>{customers.isLoading ? 'Loading customers...' : 'Walk in Customer (-)'}</option>
                {customers.data?.data?.content.map((customer) => <option key={customer.id} value={customer.id}>{customer.customerName} - {customer.mobile}</option>)}
              </select>
              <button type="button" onClick={() => navigate(`/contacts/customers/create?returnTo=${encodeURIComponent('/sales/pos')}`)} className="flex h-10 w-11 items-center justify-center rounded-r border border-l-0 border-blue-400 bg-white text-blue-600" title="Create customer">
                <Plus size={17} />
              </button>
            </div>
          </div>
          <div className={`${fieldLabelClass} xl:col-span-2`}>
            <span>Scan / Search Item</span>
            <div className="relative mt-1">
              <PackageSearch className="absolute left-3 top-3 text-blue-500" size={16} />
              <input ref={scannerInputRef} value={search} onChange={handleSearchChange} onKeyDown={handleScanKeyDown} onPaste={handleScanPaste} className={`${controlClass} pl-10 pr-12`} placeholder="Scan Barcode/Search Item/Brand Name" autoFocus />
              <button type="button" onClick={() => scanAndAddItem(search, 'button')} disabled={scanItem.isPending} className="absolute right-0 top-0 flex h-10 w-10 items-center justify-center border-l border-blue-400 text-blue-500 disabled:opacity-50"><CirclePlus size={18} /></button>
            </div>
          </div>
        </div>

        <div className="min-h-[calc(100vh-145px)] p-3">
          <section className="flex flex-col">
            <div className="min-h-[330px] flex-1 overflow-auto rounded border bg-white shadow-sm">
              <table className="w-full min-w-[2850px] border-collapse text-xs">
                <thead>
                  <tr>
                    {[
                      'ACTION',
                      'ID',
                      'ITEM',
                      'ITEM CODE',
                      'SKU',
                      'BARCODE',
                      'HSN',
                      'CATEGORY',
                      'SUBCATEGORY',
                      'BRAND',
                      'BASE UNIT',
                      'SECONDARY UNIT',
                      'CONVERSION',
                      'WAREHOUSE',
                      'BATCH',
                      'MFG DATE',
                      'EXP DATE',
                      'AVAILABLE',
                      'RESERVED',
                      'MIN STOCK',
                      'QTY',
                      'PURCHASE',
                      'PURCHASE+TAX',
                      'SALE',
                      'WHOLESALE',
                      'MRP',
                      'MSP',
                      'DISCOUNT %',
                      'PROFIT %',
                      'TAX %',
                      'AMOUNT',
                      'TAX',
                      'TOTAL',
                      'STATUS',
                      'DESCRIPTION',
                    ].map((heading) => (
                      <th key={heading} className="border border-slate-200 px-2 py-3 text-left font-bold text-slate-800">{heading}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cart.length ? cart.map((line) => {
                    const salePrice = Number(line.salePrice || 0);
                    const lineAmount = salePrice * line.quantity;
                    return (
                      <tr key={line.id} className="border-b even:bg-slate-50">
                        <td className="border border-slate-200 p-2">
                          <button type="button" onClick={() => setCart((current) => current.filter((item) => item.id !== line.id))} className="text-red-500" title="Remove item"><Trash2 size={15} /></button>
                        </td>
                        <td className="border border-slate-200 p-2">{line.id}</td>
                        <td className="border border-slate-200 p-2 font-semibold text-slate-800">{formatValue(line.itemName)}</td>
                        <td className="border border-slate-200 p-2">{formatValue(line.itemCode)}</td>
                        <td className="border border-slate-200 p-2">{formatValue(line.sku)}</td>
                        <td className="border border-slate-200 p-2">{formatValue(line.barcode)}</td>
                        <td className="border border-slate-200 p-2">{formatValue(line.hsnCode)}</td>
                        <td className="border border-slate-200 p-2">{formatNameWithId(line.categoryName, line.categoryId)}</td>
                        <td className="border border-slate-200 p-2">{formatNameWithId(line.subCategoryName, line.subCategoryId)}</td>
                        <td className="border border-slate-200 p-2">{formatNameWithId(line.brandName, line.brandId)}</td>
                        <td className="border border-slate-200 p-2">{formatNameWithId(line.baseUnitName || line.unitName, line.baseUnitId)}</td>
                        <td className="border border-slate-200 p-2">{formatNameWithId(line.secondaryUnitName, line.secondaryUnitId)}</td>
                        <td className="border border-slate-200 p-2">{formatNumber(line.conversionRate)}</td>
                        <td className="border border-slate-200 p-2">{formatNameWithId(line.warehouseName, line.warehouseId)}</td>
                        <td className="border border-slate-200 p-2">{formatValue(line.batchNo)}</td>
                        <td className="border border-slate-200 p-2">{formatValue(line.manufacturingDate)}</td>
                        <td className="border border-slate-200 p-2">{formatValue(line.expiryDate)}</td>
                        <td className="border border-slate-200 p-2">{formatNumber(line.availableQty)}</td>
                        <td className="border border-slate-200 p-2">{formatNumber(line.reservedQty)}</td>
                        <td className="border border-slate-200 p-2">{formatNumber(line.minimumStock)}</td>
                        <td className="border border-slate-200 p-2">
                          <div className="flex items-center">
                            <button type="button" onClick={() => updateQuantity(line.id, line.quantity - 1)}><Minus size={13} /></button>
                            <input value={line.quantity} onChange={(event) => updateQuantity(line.id, Number(event.target.value) || 1)} className="mx-1 h-7 w-12 border text-center" />
                            <button type="button" onClick={() => updateQuantity(line.id, line.quantity + 1)}><Plus size={13} /></button>
                          </div>
                        </td>
                        <td className="border border-slate-200 p-2">{formatNumber(line.purchasePrice)}</td>
                        <td className="border border-slate-200 p-2">{formatNumber(line.purchasePriceWithTax)}</td>
                        <td className="border border-slate-200 p-2 font-semibold">{formatNumber(line.salePrice)}</td>
                        <td className="border border-slate-200 p-2">{formatNumber(line.wholesalePrice)}</td>
                        <td className="border border-slate-200 p-2">{formatNumber(line.mrp)}</td>
                        <td className="border border-slate-200 p-2">{formatNumber(line.msp)}</td>
                        <td className="border border-slate-200 p-2">{formatNumber(line.discountPercentage)}</td>
                        <td className="border border-slate-200 p-2">{formatNumber(line.profitMargin)}</td>
                        <td className="border border-slate-200 p-2">{formatNumber(line.taxPercentage)}</td>
                        <td className="border border-slate-200 p-2">{formatNumber(lineAmount)}</td>
                        <td className="border border-slate-200 p-2">0.00</td>
                        <td className="border border-slate-200 p-2 font-bold">{formatNumber(lineAmount)}</td>
                        <td className="border border-slate-200 p-2">{getItemStatusLabel(line.status)}</td>
                        <td className="border border-slate-200 p-2">{formatValue(line.description)}</td>
                      </tr>
                    );
                  }) : (
                    <tr><td colSpan={35} className="bg-slate-50 py-4 text-center italic text-slate-600">No items are added yet!!</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-2 gap-2 py-4 text-xs font-semibold md:grid-cols-4"><span>Total Quantity: <b>{totalQuantity}</b></span><span>Discount: <b>0.00</b></span><span>Tax: <b>0.00</b></span><span>Total Price: <b>{total.toFixed(2)}</b></span></div>
            <div className="ml-auto grid w-full max-w-[820px] grid-cols-1 gap-4 md:grid-cols-2">
              <div className="border bg-white">
                <div className="grid grid-cols-1 gap-3 bg-[#f0f0f8] p-2 sm:grid-cols-[1fr_120px]">
                  <label className="text-xs font-medium text-slate-600">Payment Method ID
                    <input type="number" min="1" value={paymentMethodId || ''} onChange={(event) => setPaymentMethodId(Number(event.target.value))} className="mt-1 h-8 w-full rounded border px-2 text-xs" placeholder="Payment ID" />
                  </label>
                  <label className="text-xs font-medium text-slate-600">Amount
                    <input value={grandTotal.toFixed(2)} readOnly className="mt-1 h-8 w-full rounded border px-2 text-right" />
                  </label>
                </div>
                <p className="border-t px-3 py-2 text-right text-xs font-semibold">Balance <span className="ml-20">0</span></p>
                <p className="border-t px-3 py-2 text-right text-xs font-semibold">Change Return <span className="ml-16 text-xl text-red-500">0</span></p>
                <button className="px-2 py-1 text-xs text-blue-500">+ Add Payment Type</button>
              </div>
              <div className="border bg-white"><label className="flex items-center gap-2 bg-[#f0f0f8] p-3 text-xs font-semibold"><input type="checkbox" checked={roundOff} onChange={(event) => setRoundOff(event.target.checked)} />Round Off</label><p className="flex justify-between border-t p-3 text-xs font-bold"><span>Grand Total</span><span>{grandTotal.toFixed(2)}</span></p></div>
            </div>
          </section>
        </div>
      </main>

      <footer className="fixed inset-x-0 bottom-0 z-20 flex h-12 items-center justify-end gap-3 border-t bg-white px-4 shadow-[0_-2px_8px_rgba(0,0,0,0.06)]">
        <button onClick={() => navigate('/dashboard')} className="rounded bg-slate-100 px-5 py-2 text-sm">Close</button>
        <button onClick={() => setCart([])} className="rounded bg-slate-600 px-5 py-2 text-sm text-white">New</button>
        <button onClick={save} disabled={billing.isPending} className="rounded bg-blue-500 px-5 py-2 text-sm text-white">Save &amp; Print</button>
        <button onClick={save} disabled={billing.isPending} className="rounded bg-green-500 px-5 py-2 text-sm text-white">Save</button>
      </footer>
    </div>
  );
};
