import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Box, ChevronDown, CreditCard, LayoutDashboard, Loader2, Minus, PackageSearch, Plus, Search, Trash2, UserRound, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { customerApi, itemApi, organizationApi, paymentMethodApi, posApi, warehouseApi } from '../../../api/endpoints';
import type { ItemListItem } from '../../../api/endpoints';
import { getDefaultAuthorizedPath } from '../../../auth/featurePermissions';
import { PERMISSIONS } from '../../../auth/permissions';
import { NumericInput } from '../../../components/ui/NumericInput';
import { useAuth } from '../../../hooks/useAuth';
import { useDebounce } from '../../../hooks/useDebounce';
import { formatOrganizationAddress } from '../../organizations/organization.utils';
import type { PosBillingResponse } from '../../../types/api.types';
import type { CustomerListItem } from '../../../types/customer.types';

interface CartLine extends ItemListItem { quantity: number }

const controlClass = 'h-10 w-full rounded border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100';
const topControlClass = 'h-10 w-full rounded border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100';
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

const formatMoney = (value: number | null | undefined) => {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-';
};

const formatPercent = (value: number | null | undefined) => {
  const numberValue = Number(value || 0);
  if (!Number.isFinite(numberValue)) return '-';
  return Number.isInteger(numberValue) ? String(numberValue) : numberValue.toFixed(2);
};

const getCustomerLabel = (customer: CustomerListItem) =>
  `${customer.customerName}${customer.mobile ? ` - ${customer.mobile}` : ''}`;

const escapeHtml = (value: unknown) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const getItemImageUrl = (item: ItemListItem) => {
  const imageItem = item as ItemListItem & {
    imageUrl?: string;
    itemImageUrl?: string;
    image?: string;
    imagePath?: string;
    photoUrl?: string;
  };
  return imageItem.imageUrl || imageItem.itemImageUrl || imageItem.image || imageItem.imagePath || imageItem.photoUrl || '';
};

const getLineBaseAmount = (line: CartLine) => Number(line.salePrice || 0) * line.quantity;
const getLineDiscountAmount = (line: CartLine) => getLineBaseAmount(line) * Number(line.discountPercentage || 0) / 100;
const getLineTaxableAmount = (line: CartLine) => Math.max(0, getLineBaseAmount(line) - getLineDiscountAmount(line));
const getLineTaxAmount = (line: CartLine) => getLineTaxableAmount(line) * Number(line.taxPercentage || 0) / 100;
const getLineTotal = (line: CartLine) => getLineTaxableAmount(line) + getLineTaxAmount(line);

const formatReceiptMoney = (value: number | null | undefined) => {
  const numberValue = Number(value || 0);
  return Number.isFinite(numberValue) ? numberValue.toFixed(2) : '0.00';
};

const formatReceiptQuantity = (value: number | null | undefined) => {
  const numberValue = Number(value || 0);
  if (!Number.isFinite(numberValue)) return '0';
  return Number.isInteger(numberValue) ? String(numberValue) : numberValue.toFixed(2);
};

const formatReceiptRate = (value: number) =>
  Number.isInteger(value) ? String(value) : value.toFixed(2);

const formatReceiptDate = (value = new Date()) =>
  value.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replaceAll(' ', ' - ');

const formatReceiptStatus = (value?: string) => {
  const status = value?.trim() || 'PAID';
  return status.toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase());
};

const getReceiptTaxRows = (lines: CartLine[]) => {
  const taxRows = new Map<number, number>();
  lines.forEach((line) => {
    const rate = Number(line.taxPercentage || 0);
    const normalizedRate = Number.isFinite(rate) ? rate : 0;
    taxRows.set(normalizedRate, (taxRows.get(normalizedRate) || 0) + getLineTaxAmount(line));
  });
  if (!taxRows.has(0)) taxRows.set(0, 0);
  return [...taxRows.entries()].sort(([left], [right]) => left - right);
};

export const PosPage: React.FC = () => {
  const navigate = useNavigate();
  const { user, hasPermission } = useAuth();
  const defaultPath = getDefaultAuthorizedPath(user?.permissions, user?.role);
  const canViewDashboard = hasPermission(PERMISSIONS.DASHBOARD_VIEW);
  const canViewCustomers = hasPermission(PERMISSIONS.CUSTOMER_VIEW);
  const canCreateCustomer = hasPermission(PERMISSIONS.CUSTOMER_CREATE);
  const canViewSales = hasPermission(PERMISSIONS.SALES_VIEW);
  const canViewItems = hasPermission(PERMISSIONS.ITEM_VIEW);
  const canViewPaymentIn = hasPermission(PERMISSIONS.PAYMENT_IN_VIEW);
  const canCreateExpenseMaster = hasPermission(PERMISSIONS.EXPENSE_CREATE);
  const [customerId, setCustomerId] = useState(0);
  const [warehouseId, setWarehouseId] = useState(0);
  const [paymentMethodId, setPaymentMethodId] = useState(0);
  const [paymentMethodSearch, setPaymentMethodSearch] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedCustomerLabel, setSelectedCustomerLabel] = useState('');
  const [paymentMethodMenuOpen, setPaymentMethodMenuOpen] = useState(false);
  const [customerMenuOpen, setCustomerMenuOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [roundOff, setRoundOff] = useState(false);
  const paymentMethodSelectRef = useRef<HTMLDivElement | null>(null);
  const customerSelectRef = useRef<HTMLDivElement | null>(null);
  const scannerInputRef = useRef<HTMLInputElement | null>(null);
  const scannerBufferRef = useRef('');
  const scannerFirstKeyAtRef = useRef(0);
  const scannerLastKeyAtRef = useRef(0);
  const scannerTimerRef = useRef<number | null>(null);
  const lastSubmittedScanRef = useRef<{ value: string; at: number }>({ value: '', at: 0 });
  const debouncedCustomerSearch = useDebounce(customerSearch);

  const customers = useQuery({ queryKey: ['pos-customers', debouncedCustomerSearch], queryFn: () => customerApi.getAll({ page: 0, size: 100, search: debouncedCustomerSearch }) });
  const warehouses = useQuery({ queryKey: ['pos-warehouses'], queryFn: () => warehouseApi.getAll() });
  const paymentMethods = useQuery({ queryKey: ['pos-payment-methods'], queryFn: () => paymentMethodApi.getAll('') });
  const organization = useQuery({
    queryKey: ['pos-organization', user?.organizationId],
    queryFn: () => organizationApi.getById(user!.organizationId),
    enabled: Boolean(user?.organizationId),
  });
  const organizationDetails = organization.data?.data;
  const customerRows = customers.data?.data?.content || [];
  const selectedCustomer = customerRows.find((customer) => customer.id === customerId);
  const customerDisplayLabel = selectedCustomerLabel || (selectedCustomer ? getCustomerLabel(selectedCustomer) : '');
  const warehouseRows = warehouses.data?.data || [];
  const paymentMethodRows = (paymentMethods.data?.data?.content || [])
    .filter((method) => method.status === 'ACTIVE' || method.id === paymentMethodId);
  const selectedPaymentMethod = paymentMethodRows.find((method) => method.id === paymentMethodId);
  const filteredPaymentMethodRows = paymentMethodRows.filter((method) => {
    const normalizedSearch = paymentMethodSearch.trim().toLowerCase();
    return !normalizedSearch
      || method.name.toLowerCase().includes(normalizedSearch)
      || String(method.description || '').toLowerCase().includes(normalizedSearch);
  });

  useEffect(() => {
    const closeOpenMenus = (event: MouseEvent) => {
      if (paymentMethodSelectRef.current && !paymentMethodSelectRef.current.contains(event.target as Node)) {
        setPaymentMethodMenuOpen(false);
      }
      if (customerSelectRef.current && !customerSelectRef.current.contains(event.target as Node)) {
        setCustomerMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', closeOpenMenus);
    return () => document.removeEventListener('mousedown', closeOpenMenus);
  }, []);

  useEffect(() => {
    if (!warehouseId && warehouseRows.length) {
      setWarehouseId(warehouseRows[0].id);
    }
  }, [warehouseId, warehouseRows]);
  useEffect(() => {
    if (!paymentMethodId && paymentMethodRows.length) {
      setPaymentMethodId(paymentMethodRows[0].id);
    }
  }, [paymentMethodId, paymentMethodRows]);
  useEffect(() => {
    if (customerId || !customerRows.length) return;
    const walkInCustomer = customerRows.find((customer) => customer.customerName.trim().toLowerCase() === 'walk-in customer');
    if (walkInCustomer) {
      setCustomerId(walkInCustomer.id);
      setSelectedCustomerLabel(getCustomerLabel(walkInCustomer));
    }
  }, [customerId, customerRows]);

  const addItem = useCallback((item: ItemListItem) => setCart((current) => {
    const availableQty = Number(item.availableQty ?? 0);
    const existing = current.find((line) => line.id === item.id);
    if (existing) return current.map((line) => line.id === item.id ? { ...line, quantity: Math.min(line.quantity + 1, availableQty) } : line);
    return [...current, { ...item, availableQty, discountPercentage: Number(item.discountPercentage || 0), quantity: 1 }];
  }), []);
  const updateQuantity = (id: number, quantity: number) => setCart((current) => current.map((line) => line.id === id ? { ...line, quantity: Math.max(1, Math.min(quantity, line.availableQty)) } : line));
  const updateDiscount = (id: number, discountPercentage: number) => setCart((current) => current.map((line) => line.id === id ? { ...line, discountPercentage: Math.max(0, Math.min(discountPercentage, 100)) } : line));
  const totalQuantity = useMemo(() => cart.reduce((sum, line) => sum + line.quantity, 0), [cart]);
  const totalDiscount = useMemo(() => cart.reduce((sum, line) => sum + getLineDiscountAmount(line), 0), [cart]);
  const totalTax = useMemo(() => cart.reduce((sum, line) => sum + getLineTaxAmount(line), 0), [cart]);
  const total = useMemo(() => cart.reduce((sum, line) => sum + getLineTotal(line), 0), [cart]);
  const grandTotal = roundOff ? Math.round(total) : total;

  const billing = useMutation({
    mutationFn: () => posApi.createBill({
      customerId,
      warehouseId,
      paymentMethodId,
      items: cart.map((line) => ({
        itemId: line.id,
        quantity: line.quantity,
        discountPercent: Number(line.discountPercentage || 0),
        taxPercent: Number(line.taxPercentage || 0),
      })),
    }),
    onSuccess: () => { toast.success('POS bill created successfully'); setCart([]); },
    onError: (error: any) => toast.error(error?.message || 'Failed to create POS bill'),
  });
  const scanItem = useMutation({
    mutationFn: async (rawValue: string): Promise<ItemListItem | null> => {
      const scannedValue = rawValue.trim();
      const itemId = parseScannedItemId(scannedValue);
      if (itemId) {
        console.log('[POS Scanner] Calling get item API:', `/api/v1/items/${itemId}`);
        const response = await itemApi.getById(itemId, warehouseId || undefined);
        return response.data || null;
      }

      console.log('[POS Scanner] Non-numeric barcode. Searching items by value:', scannedValue);
      const response = await itemApi.getAll({ page: 0, size: 5, search: scannedValue, warehouseId: warehouseId || undefined });
      const results = response.data?.content || [];
      const exactMatch = results.find((item) =>
        String(item.itemCode || '') === scannedValue ||
        String(item.sku || '') === scannedValue
      );
      const matchedItem = exactMatch || results[0] || null;
      if (!matchedItem) return null;
      console.log('[POS Scanner] Calling get item API:', `/api/v1/items/${matchedItem.id}`);
      const itemResponse = await itemApi.getById(matchedItem.id, warehouseId || undefined);
      return itemResponse.data || matchedItem;
    },
    onSuccess: (item) => {
      console.log('[POS Scanner] Item lookup success:', item);
      if (!item) {
        toast.error('No item found for this barcode');
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
  const printReceipt = (cartSnapshot: CartLine[], billingResult?: PosBillingResponse, popup = window.open('', '_blank')) => {
    if (!popup) return;
    const customer = customerRows.find((entry) => entry.id === customerId);
    const customerLabel = selectedCustomerLabel || (customer ? getCustomerLabel(customer) : 'Walk in Customer');
    const method = paymentMethodRows.find((entry) => entry.id === paymentMethodId);
    const organizationAddress = formatOrganizationAddress(organizationDetails?.address);
    const organizationAddressLine = organizationAddress === 'N/A' ? '' : organizationAddress;
    const receiptQuantity = cartSnapshot.reduce((sum, line) => sum + line.quantity, 0);
    const receiptSubTotal = cartSnapshot.reduce((sum, line) => sum + getLineBaseAmount(line), 0);
    const receiptDiscount = cartSnapshot.reduce((sum, line) => sum + getLineDiscountAmount(line), 0);
    const receiptTaxRows = getReceiptTaxRows(cartSnapshot);
    const receiptTotal = cartSnapshot.reduce((sum, line) => sum + getLineTotal(line), 0);
    const receiptGrandTotal = roundOff ? Math.round(receiptTotal) : receiptTotal;
    const receiptStatus = formatReceiptStatus(billingResult?.paymentStatus);
    const rows = cartSnapshot.map((line, index) => {
      const amount = getLineTotal(line);
      return `<tr>
        <td class="sn">${index + 1}</td>
        <td class="item">${escapeHtml(line.itemName)}</td>
        <td class="qty">${formatReceiptQuantity(line.quantity)}</td>
        <td class="price">${formatReceiptMoney(line.salePrice)}</td>
        <td class="amount">${formatReceiptMoney(amount)}</td>
      </tr>`;
    }).join('');
    const taxRows = receiptTaxRows.map(([rate, taxAmount]) =>
      `<div class="summary-row tax-row"><span>IGST at ${formatReceiptRate(rate)}%</span><span>${formatReceiptMoney(taxAmount)}</span></div>`
    ).join('');

    popup.document.write(`<!doctype html>
<html>
<head>
  <title>${escapeHtml(billingResult?.invoiceNo || 'POS Receipt')}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #f3f4f6;
      color: #000;
      font-family: Arial, Helvetica, sans-serif;
      font-size: 18px;
    }
    .receipt-shell {
      width: 86mm;
      margin: 24px auto;
      padding: 8px;
      background: #eeeeee;
    }
    .receipt {
      position: relative;
      min-height: 152mm;
      overflow: hidden;
      background: #fff;
      padding: 14px;
    }
    .ribbon {
      position: absolute;
      top: 22px;
      left: -46px;
      width: 160px;
      padding: 9px 0;
      transform: rotate(-45deg);
      background: #1187c9;
      color: #fff;
      text-align: center;
      font-size: 18px;
      font-weight: 700;
    }
    .header-spacer { height: 116px; }
    .store {
      text-align: center;
      line-height: 1.12;
    }
    .store h1 {
      margin: 0 0 8px;
      font-size: 28px;
      font-weight: 500;
      letter-spacing: 0;
    }
    .store p {
      margin: 2px 0;
      font-size: 17px;
    }
    .meta {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      margin-top: 22px;
      font-size: 17px;
      font-weight: 500;
    }
    .dash {
      border-top: 2px dashed #000;
      margin: 14px 0 0;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      margin-top: 8px;
      font-size: 18px;
    }
    th {
      padding: 0 0 10px;
      text-align: left;
      font-size: 19px;
      font-weight: 700;
    }
    td {
      padding: 12px 0;
      vertical-align: top;
    }
    .sn { width: 10%; }
    .item { width: 34%; word-break: break-word; }
    .qty { width: 13%; text-align: center; }
    .price { width: 20%; text-align: right; }
    .amount { width: 23%; text-align: right; }
    .summary {
      margin-top: 4px;
      font-size: 18px;
    }
    .summary-row {
      display: grid;
      grid-template-columns: 1fr 52px 104px;
      align-items: center;
      gap: 8px;
      padding: 7px 0;
    }
    .summary-row .right { text-align: right; }
    .tax-row {
      grid-template-columns: 1fr 104px;
      text-align: right;
    }
    .total-row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 8px 0;
      font-size: 18px;
      font-weight: 600;
    }
    .footer {
      padding-top: 24px;
      text-align: center;
      font-size: 18px;
      font-weight: 500;
    }
    .muted {
      margin-top: 6px;
      font-size: 12px;
      color: #444;
      text-align: center;
    }
    @page { size: 86mm auto; margin: 0; }
    @media print {
      body { background: #fff; }
      .receipt-shell {
        width: 86mm;
        margin: 0;
        padding: 0;
        background: #fff;
      }
      .receipt { min-height: auto; }
    }
  </style>
</head>
<body>
  <div class="receipt-shell">
    <section class="receipt">
      <div class="ribbon">${escapeHtml(receiptStatus)}</div>
      <div class="header-spacer"></div>
      <header class="store">
        <h1>${escapeHtml(organizationDetails?.name || user?.organizationName || 'SLEEK BILL')}</h1>
        ${organizationAddressLine ? `<p>${escapeHtml(organizationAddressLine)}</p>` : ''}
        ${organizationDetails?.phone ? `<p>PHONE : ${escapeHtml(organizationDetails.phone)}</p>` : ''}
        ${organizationDetails?.gstNumber ? `<p>GSTIN : ${escapeHtml(organizationDetails.gstNumber)}</p>` : ''}
      </header>
      <div class="meta">
        <span>Bill No: ${escapeHtml(billingResult?.invoiceNo || '-')}</span>
        <span>Date: ${formatReceiptDate()}</span>
      </div>
      <div class="dash"></div>
      <table>
        <thead>
          <tr>
            <th class="sn">SN</th>
            <th class="item">Item</th>
            <th class="qty">Qty</th>
            <th class="price">Price</th>
            <th class="amount">Amt</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="dash"></div>
      <section class="summary">
        <div class="summary-row">
          <span>Subtotal</span>
          <span>${formatReceiptQuantity(receiptQuantity)}</span>
          <span class="right">&#8377; ${formatReceiptMoney(receiptSubTotal)}</span>
        </div>
        ${receiptDiscount > 0 ? `<div class="summary-row"><span>Discount</span><span></span><span class="right">- &#8377; ${formatReceiptMoney(receiptDiscount)}</span></div>` : ''}
      </section>
      <div class="dash"></div>
      <section class="summary">${taxRows}</section>
      <div class="dash"></div>
      <div class="total-row"><span>TOTAL</span><span>&#8377; ${formatReceiptMoney(receiptGrandTotal)}</span></div>
      <div class="dash"></div>
      <div class="footer">Thank You</div>
      <div class="muted">Customer: ${escapeHtml(customerLabel)} | Payment: ${escapeHtml(method?.name || '-')}</div>
    </section>
  </div>
  <script>
    window.onload = () => {
      window.focus();
      window.print();
    };
  </script>
</body>
</html>`);
    popup.document.close();
  };
  const submitBill = async (print = false) => {
    if (!customerId) return toast.error('Please select a customer');
    if (!warehouseId) return toast.error('Please select a warehouse');
    if (!paymentMethodId) return toast.error('Please select a payment method');
    if (!cart.length) return toast.error('Please add at least one item');
    const cartSnapshot = [...cart];
    const receiptWindow = print ? window.open('', '_blank') : null;
    if (print && !receiptWindow) {
      toast.error('Please allow popups to print the bill');
      return;
    }
    try {
      const response = await billing.mutateAsync();
      if (print) printReceipt(cartSnapshot, response.data, receiptWindow);
    } catch {
      if (receiptWindow && !receiptWindow.closed) receiptWindow.close();
      // The mutation onError handler already reports the API error.
    }
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#f5f6ff] text-slate-700">
      <header className="flex h-12 shrink-0 items-center justify-between border-b bg-white px-3 shadow-sm">
        <button onClick={() => navigate(defaultPath)} className="text-xl font-semibold text-blue-600">Texmintra</button>
        <nav className="hidden items-center gap-5 text-xs text-slate-600 md:flex">
          {canViewDashboard && <button onClick={() => navigate('/dashboard')} className="flex items-center gap-1 hover:text-blue-600"><LayoutDashboard size={13} />Dashboard</button>}
          {canViewCustomers && <button onClick={() => navigate('/contacts/customers')} className="flex items-center gap-1 hover:text-blue-600"><Users size={13} />Customer List</button>}
          {canViewSales && <button onClick={() => navigate('/sales/invoices')} className="flex items-center gap-1 hover:text-blue-600"><CreditCard size={13} />Invoices</button>}
          {canViewItems && <button onClick={() => navigate('/items')} className="flex items-center gap-1 hover:text-blue-600"><Box size={13} />Item List</button>}
          {canViewPaymentIn && <button onClick={() => navigate('/sales/payment-in')} className="flex items-center gap-1 hover:text-blue-600"><CreditCard size={13} />Payment In</button>}
        </nav>
      </header>

      <main className="flex-1 overflow-y-auto pb-16">
        <div className="grid grid-cols-1 gap-3 border-b p-3 md:grid-cols-2 xl:grid-cols-4">
          <div className={`${fieldLabelClass} relative min-w-0`} ref={paymentMethodSelectRef}>
            <span>Payment Method</span>
            <div className="mt-1 flex">
              <button
                type="button"
                disabled={paymentMethods.isLoading || paymentMethods.isError}
                onClick={() => {
                  setPaymentMethodMenuOpen((open) => !open);
                  setPaymentMethodSearch('');
                }}
                className={[
                  'flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-not-allowed disabled:opacity-60',
                  topControlClass,
                  canCreateExpenseMaster ? 'rounded-r-none' : '',
                  paymentMethodMenuOpen ? 'border-blue-500 ring-2 ring-blue-100' : 'hover:border-blue-300',
                ].filter(Boolean).join(' ')}
                aria-expanded={paymentMethodMenuOpen}
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-500">
                  <CreditCard size={15} />
                </span>
                <span className={`min-w-0 flex-1 truncate text-base font-normal ${selectedPaymentMethod ? 'text-slate-800' : 'text-slate-400'}`}>
                  {paymentMethods.isLoading ? 'Loading payment methods...' : paymentMethods.isError ? 'Failed to load payment methods' : selectedPaymentMethod?.name || 'Select payment method'}
                </span>
                {paymentMethods.isFetching ? <Loader2 className="shrink-0 animate-spin text-blue-500" size={18} /> : <ChevronDown className={`shrink-0 text-slate-600 transition ${paymentMethodMenuOpen ? 'rotate-180' : ''}`} size={20} />}
              </button>
              {canCreateExpenseMaster && <button type="button" onClick={() => navigate(`/expenses/payment-types/create?returnTo=${encodeURIComponent('/sales/pos')}`)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-r border border-l-0 border-blue-400 bg-white text-blue-600 transition hover:bg-blue-50" title="Create payment method">
                <Plus size={17} />
              </button>}
            </div>
            {paymentMethodMenuOpen && (
              <div className={`absolute left-0 z-30 mt-1 max-h-80 overflow-hidden rounded-b border border-blue-400 bg-white shadow-xl ${canCreateExpenseMaster ? 'right-10' : 'right-0'}`}>
                <div className="border-b border-slate-100 p-2">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-2.5 text-slate-400" size={15} />
                    <input
                      value={paymentMethodSearch}
                      onChange={(event) => setPaymentMethodSearch(event.target.value)}
                      className="h-9 w-full rounded border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                      placeholder="Search payment method"
                      autoFocus
                    />
                  </div>
                </div>
                <div className="max-h-60 overflow-y-auto">
                  {paymentMethods.isLoading ? (
                    <div className="flex h-20 items-center justify-center gap-2 text-sm text-slate-500">
                      <Loader2 className="animate-spin" size={16} />
                      Loading payment methods...
                    </div>
                  ) : filteredPaymentMethodRows.length ? filteredPaymentMethodRows.map((method) => (
                    <button
                      key={method.id}
                      type="button"
                      onClick={() => {
                        setPaymentMethodId(method.id);
                        setPaymentMethodSearch('');
                        setPaymentMethodMenuOpen(false);
                      }}
                      className={`flex w-full items-center gap-4 border-b border-slate-100 px-7 py-5 text-left transition last:border-b-0 ${method.id === paymentMethodId ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-500">
                        <CreditCard size={17} />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-base font-medium text-slate-800">{method.name}</span>
                        <span className="mt-1 block truncate text-xs font-normal text-slate-500">{method.description || 'Payment method'}</span>
                      </span>
                    </button>
                  )) : (
                    <div className="px-7 py-6 text-sm font-normal text-slate-500">No payment methods found</div>
                  )}
                </div>
              </div>
            )}
          </div>
          <div className={`${fieldLabelClass} relative min-w-0`} ref={customerSelectRef}>
            <span>Customer</span>
            <div className="mt-1 flex">
              <button
                type="button"
                onClick={() => {
                  setCustomerMenuOpen((open) => !open);
                  setCustomerSearch('');
                }}
                className={[
                  'flex min-w-0 flex-1 items-center gap-3 text-left',
                  topControlClass,
                  canCreateCustomer ? 'rounded-r-none' : '',
                  customerMenuOpen ? 'border-blue-500 ring-2 ring-blue-100' : 'hover:border-blue-300',
                ].filter(Boolean).join(' ')}
                aria-expanded={customerMenuOpen}
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-500">
                  <UserRound size={15} />
                </span>
                <span className={`min-w-0 flex-1 truncate text-base font-normal ${customerDisplayLabel ? 'text-slate-800' : 'text-slate-400'}`}>
                  {customerDisplayLabel || 'Select customer'}
                </span>
                {customers.isFetching ? <Loader2 className="shrink-0 animate-spin text-blue-500" size={18} /> : <ChevronDown className={`shrink-0 text-slate-600 transition ${customerMenuOpen ? 'rotate-180' : ''}`} size={20} />}
              </button>
              {canCreateCustomer && <button type="button" onClick={() => navigate(`/contacts/customers/create?returnTo=${encodeURIComponent('/sales/pos')}`)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-r border border-l-0 border-blue-400 bg-white text-blue-600 transition hover:bg-blue-50" title="Create customer">
                <Plus size={17} />
              </button>}
            </div>
            {customerMenuOpen && (
              <div className={`absolute left-0 z-30 mt-1 max-h-80 overflow-hidden rounded-b border border-blue-400 bg-white shadow-xl ${canCreateCustomer ? 'right-10' : 'right-0'}`}>
                <div className="border-b border-slate-100 p-2">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-2.5 text-slate-400" size={15} />
                    <input
                      value={customerSearch}
                      onChange={(event) => setCustomerSearch(event.target.value)}
                      className="h-9 w-full rounded border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                      placeholder="Search customer"
                      autoFocus
                    />
                  </div>
                </div>
                <div className="max-h-60 overflow-y-auto">
                  {customers.isLoading ? (
                    <div className="flex h-20 items-center justify-center gap-2 text-sm text-slate-500">
                      <Loader2 className="animate-spin" size={16} />
                      Loading customers...
                    </div>
                  ) : customerRows.length ? customerRows.map((customer) => {
                    const label = getCustomerLabel(customer);
                    return (
                      <button
                        key={customer.id}
                        type="button"
                        onClick={() => {
                          setCustomerId(customer.id);
                          setSelectedCustomerLabel(label);
                          setCustomerSearch('');
                          setCustomerMenuOpen(false);
                        }}
                        className={`flex w-full items-center gap-4 border-b border-slate-100 px-7 py-5 text-left transition last:border-b-0 ${customer.id === customerId ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
                      >
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-500">
                          <UserRound size={17} />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-base font-medium text-slate-800">{customer.customerName}</span>
                          <span className="mt-1 block truncate text-xs font-normal text-slate-500">{customer.mobile || customer.customerCode}</span>
                        </span>
                      </button>
                    );
                  }) : (
                    <div className="px-7 py-6 text-sm font-normal text-slate-500">No customers found</div>
                  )}
                </div>
              </div>
            )}
          </div>
          <div className={`${fieldLabelClass} xl:col-span-2`}>
            <span>Scan / Search Item</span>
            <div className="relative mt-1">
              <PackageSearch className="absolute left-3 top-3 text-blue-500" size={16} />
              <input ref={scannerInputRef} value={search} onChange={handleSearchChange} onKeyDown={handleScanKeyDown} onPaste={handleScanPaste} className={`${controlClass} pl-10 pr-20`} placeholder="Scan Barcode/ Search id" autoFocus />
              <button type="button" onClick={() => scanAndAddItem(search, 'button')} disabled={scanItem.isPending} className="absolute right-0 top-0 flex h-10 w-16 items-center justify-center border-l border-blue-400 text-xs font-semibold text-blue-600 transition hover:bg-blue-50 disabled:opacity-50">
                {scanItem.isPending ? <Loader2 className="animate-spin" size={16} /> : 'Load'}
              </button>
            </div>
          </div>
        </div>

        <div className="min-h-[calc(100vh-145px)] p-3">
          <section className="flex flex-col">
            <div className="min-h-[330px] flex-1 overflow-auto rounded-lg border border-slate-200 bg-white shadow-sm">
              <table className="w-full min-w-[1060px] border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-600">
                    <th className="w-10 border-b border-r border-slate-200 px-3 py-3 text-left font-bold">#</th>
                    <th className="min-w-[240px] border-b border-r border-slate-200 px-3 py-3 text-left font-bold">Item Details</th>
                    <th className="w-28 border-b border-r border-slate-200 px-3 py-3 text-left font-bold">SKU / HSN</th>
                    <th className="w-28 border-b border-r border-slate-200 px-3 py-3 text-left font-bold">Batch</th>
                    <th className="w-28 border-b border-r border-slate-200 px-3 py-3 text-center font-bold">Qty</th>
                    <th className="w-20 border-b border-r border-slate-200 px-3 py-3 text-left font-bold">Unit</th>
                    <th className="w-28 border-b border-r border-slate-200 px-3 py-3 text-right font-bold">Price (₹)</th>
                    <th className="w-24 border-b border-r border-slate-200 px-3 py-3 text-right font-bold">Disc. (%)</th>
                    <th className="w-24 border-b border-r border-slate-200 px-3 py-3 text-right font-bold">Tax (%)</th>
                    <th className="w-32 border-b border-r border-slate-200 px-3 py-3 text-right font-bold">Amount (₹)</th>
                    <th className="w-24 border-b border-slate-200 px-3 py-3 text-center font-bold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {cart.length ? cart.map((line, index) => {
                    const imageUrl = getItemImageUrl(line);
                    const lineAmount = getLineTotal(line);
                    return (
                      <tr key={line.id} className="border-b border-slate-100 bg-white text-slate-700 transition hover:bg-slate-50">
                        <td className="border-r border-slate-100 px-3 py-3 font-semibold text-slate-500">{index + 1}</td>
                        <td className="border-r border-slate-100 px-3 py-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-slate-50 text-slate-400">
                              {imageUrl ? <img src={imageUrl} alt={line.itemName} className="h-full w-full object-cover" /> : <Box size={19} />}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate font-semibold text-slate-900">{formatValue(line.itemName)}</p>
                              <p className="mt-1 truncate text-[11px] text-slate-500">Brand: {formatValue(line.brandName)}</p>
                            </div>
                          </div>
                        </td>
                        <td className="border-r border-slate-100 px-3 py-3">
                          <p className="font-medium text-slate-800">{formatValue(line.sku || line.itemCode)}</p>
                          <p className="mt-1 text-[11px] text-slate-500">{formatValue(line.hsnCode)}</p>
                        </td>
                        <td className="border-r border-slate-100 px-3 py-3 font-medium text-slate-700">{formatValue(line.batchNo)}</td>
                        <td className="border-r border-slate-100 px-3 py-3">
                          <div className="mx-auto inline-flex h-8 items-center overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
                            <button type="button" onClick={() => updateQuantity(line.id, line.quantity - 1)} className="flex h-8 w-8 items-center justify-center text-slate-500 transition hover:bg-slate-50" title="Decrease quantity"><Minus size={13} /></button>
                            <NumericInput min={1} max={line.availableQty} integer value={line.quantity} onValueChange={(value) => updateQuantity(line.id, value)} containerClassName="w-10" className="h-8 rounded-none border-0 px-0 text-center text-xs font-semibold focus:ring-0" />
                            <button type="button" onClick={() => updateQuantity(line.id, line.quantity + 1)} className="flex h-8 w-8 items-center justify-center text-slate-500 transition hover:bg-slate-50" title="Increase quantity"><Plus size={13} /></button>
                          </div>
                        </td>
                        <td className="border-r border-slate-100 px-3 py-3 font-medium text-slate-700">{formatValue(line.baseUnitName || line.unitName)}</td>
                        <td className="border-r border-slate-100 px-3 py-3 text-right font-semibold text-slate-900">{formatMoney(line.salePrice)}</td>
                        <td className="border-r border-slate-100 px-3 py-3">
                          <NumericInput
                            min={0}
                            max={100}
                            value={formatPercent(line.discountPercentage)}
                            onValueChange={(value) => updateDiscount(line.id, value)}
                            containerClassName="ml-auto w-20"
                            className="h-8 rounded-md border-slate-200 px-2 text-right text-xs font-medium focus:ring-1"
                          />
                        </td>
                        <td className="border-r border-slate-100 px-3 py-3 text-right">{formatPercent(line.taxPercentage)}</td>
                        <td className="border-r border-slate-100 px-3 py-3 text-right font-bold text-slate-900">{formatMoney(lineAmount)}</td>
                        <td className="px-3 py-3">
                          <div className="flex items-center justify-center gap-2">
                            <button type="button" onClick={() => setCart((current) => current.filter((item) => item.id !== line.id))} className="text-red-500 transition hover:text-red-700" title="Remove item"><Trash2 size={15} /></button>
                          </div>
                        </td>
                      </tr>
                    );
                  }) : (
                    <tr><td colSpan={11} className="bg-slate-50 py-10 text-center italic text-slate-600">No items are added yet!!</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-2 gap-2 py-4 text-xs font-semibold md:grid-cols-4"><span>Total Quantity: <b>{totalQuantity}</b></span><span>Discount: <b>{formatMoney(totalDiscount)}</b></span><span>Tax: <b>{formatMoney(totalTax)}</b></span><span>Total Price: <b>{formatMoney(total)}</b></span></div>
            <div className="ml-auto grid w-full max-w-[820px] grid-cols-1 gap-4 md:grid-cols-2">
              <div className="border bg-white">
                <div className="grid grid-cols-1 gap-3 bg-[#f0f0f8] p-2 sm:grid-cols-[1fr_120px]">
                  <label className="text-xs font-medium text-slate-600">Payment Method
                    <select value={paymentMethodId} onChange={(event) => setPaymentMethodId(Number(event.target.value))} className="mt-1 h-8 w-full rounded border px-2 text-xs" disabled={paymentMethods.isLoading || paymentMethods.isError}>
                      <option value={0}>Choose</option>
                      {paymentMethodRows.map((method) => <option key={method.id} value={method.id}>{method.name}</option>)}
                    </select>
                  </label>
                  <label className="text-xs font-medium text-slate-600">Amount
                    <input value={formatMoney(grandTotal)} readOnly className="mt-1 h-8 w-full rounded border px-2 text-right" />
                  </label>
                </div>
                <p className="border-t px-3 py-2 text-right text-xs font-semibold">Balance <span className="ml-20">0</span></p>
                <p className="border-t px-3 py-2 text-right text-xs font-semibold">Change Return <span className="ml-16 text-xl text-red-500">0</span></p>
                {canCreateExpenseMaster && <button type="button" onClick={() => navigate(`/expenses/payment-types/create?returnTo=${encodeURIComponent('/sales/pos')}`)} className="px-2 py-1 text-xs text-blue-500">+ Add Payment Type</button>}
              </div>
              <div className="border bg-white"><label className="flex items-center gap-2 bg-[#f0f0f8] p-3 text-xs font-semibold"><input type="checkbox" checked={roundOff} onChange={(event) => setRoundOff(event.target.checked)} />Round Off</label><p className="flex justify-between border-t p-3 text-xs font-bold"><span>Grand Total</span><span>{formatMoney(grandTotal)}</span></p></div>
            </div>
          </section>
        </div>
      </main>

      <footer className="fixed inset-x-0 bottom-0 z-20 flex h-12 items-center justify-end gap-3 border-t bg-white px-4 shadow-[0_-2px_8px_rgba(0,0,0,0.06)]">
        <button onClick={() => navigate(defaultPath)} className="rounded bg-slate-100 px-5 py-2 text-sm">Close</button>
        <button onClick={() => setCart([])} className="rounded bg-slate-600 px-5 py-2 text-sm text-white">New</button>
        <button onClick={() => submitBill(true)} disabled={billing.isPending} className="rounded bg-blue-500 px-5 py-2 text-sm text-white">Save &amp; Print</button>
        <button onClick={() => submitBill(false)} disabled={billing.isPending} className="rounded bg-green-500 px-5 py-2 text-sm text-white">Save</button>
      </footer>
    </div>
  );
};
