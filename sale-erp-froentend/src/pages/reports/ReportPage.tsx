import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  bankAccountApi,
  brandApi,
  cashApi,
  categoryApi,
  customerApi,
  expenseApi,
  expenseSubCategoryApi,
  itemApi,
  paymentMethodApi,
  reportsApi,
  stockAdjustmentApi,
  stockTransferApi,
  supplierApi,
  warehouseApi,
} from '../../api/endpoints';
import { Button } from '../../components/ui/Button';
import { Loader } from '../../components/ui/Loader';

type FieldType = 'date' | 'select' | 'number' | 'radio';

interface FieldConfig {
  key: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  options?: Array<{ label: string; value: string }>;
}

interface ReportConfig {
  title: string;
  breadcrumb?: string;
  fields?: FieldConfig[];
  columns: string[];
  fetch: (filters: Record<string, string>) => Promise<any>;
}

export type ReportKey =
  | 'batch'
  | 'serial'
  | 'general'
  | 'purchase'
  | 'itemPurchase'
  | 'purchasePayment'
  | 'sale'
  | 'itemSale'
  | 'salePayment'
  | 'customerDue'
  | 'supplierDue'
  | 'expense'
  | 'expenseItem'
  | 'expensePayment'
  | 'cashFlow'
  | 'bankStatement'
  | 'supplierLedger'
  | 'customerLedger'
  | 'gst'
  | 'gstr1'
  | 'gstr2'
  | 'stockTransfer'
  | 'itemStockTransfer'
  | 'stockAdjustment'
  | 'itemStockAdjustment'
  | 'stock'
  | 'stockBatch'
  | 'stockSerial'
  | 'stockGeneral'
  | 'lowStock'
  | 'inventory'
  | 'topSelling'
  | 'dayBook'
  | 'expiredItem'
  | 'reorderItem';

const inputClass = 'h-10 w-full rounded border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-gray-50';

const toIsoDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
const today = new Date();
const defaultFrom = toIsoDate(new Date(today.getFullYear(), today.getMonth(), 1));
const defaultTo = toIsoDate(today);

const formatDateForApi = (value: string) => value;

const unwrapRows = (response: any) => {
  const data = response?.data ?? response;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.records)) return data.records;
  if (Array.isArray(data?.content)) return data.content;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.transactions)) return data.transactions;
  if (data && typeof data === 'object') return [data];
  return [];
};

const valueByColumn = (row: any, column: string) => {
  const normalized = column.toLowerCase().replaceAll('/', ' ').replaceAll('.', '').replaceAll('#', '').replaceAll(' ', '');
  const candidates = [
    normalized,
    column,
    column.toLowerCase(),
    column.replaceAll(' ', ''),
    column.replaceAll(' ', '').replaceAll('/', ''),
  ];
  for (const key of candidates) {
    if (row?.[key] !== undefined && row?.[key] !== null) return row[key];
  }
  const aliases: Record<string, string[]> = {
    date: ['date', 'invoiceDate', 'purchaseDate', 'transactionDate', 'createdAt'],
    invoicereferenceno: ['invoiceNo', 'referenceNo', 'purchaseNo', 'saleNo', 'invoiceReferenceNo'],
    supplier: ['supplierName', 'supplier'],
    customer: ['customerName', 'customer'],
    partyname: ['partyName', 'customerName', 'supplierName'],
    grandtotal: ['grandTotal', 'totalAmount', 'total'],
    paidamount: ['paidAmount', 'paid', 'amount'],
    balance: ['balance', 'dueAmount'],
    itemname: ['itemName', 'name'],
    brand: ['brandName', 'brand'],
    quantity: ['quantity', 'qty'],
    stockimpact: ['stockImpact', 'impact'],
    stock: ['stock', 'availableQty', 'availableStock'],
    paymenttype: ['paymentType', 'paymentMethodName'],
    duepayment: ['duePayment', 'dueAmount', 'balance'],
    paymentstatus: ['paymentStatus', 'status'],
    taxamount: ['taxAmount', 'gstAmount'],
    transfercode: ['transferCode', 'transferNo'],
    adjustmentcode: ['adjustmentCode', 'adjustmentNo'],
    referenceno: ['referenceNo', 'invoiceNo', 'purchaseNo', 'saleNo'],
    expensecode: ['expenseCode', 'expenseNo', 'expenseNumber'],
    category: ['categoryName', 'category'],
    subcategory: ['subCategoryName', 'subcategoryName', 'subCategory', 'subcategory'],
    unitprice: ['unitPrice', 'price', 'rate'],
    total: ['total', 'totalAmount', 'grandTotal'],
    currentstock: ['currentStock', 'availableQty', 'availableStock'],
    availableqty: ['availableQty', 'availableStock', 'quantity'],
    minimumstock: ['minimumStock', 'minStock'],
    unit: ['unitName', 'unit'],
    daysuntilexpiry: ['daysUntilExpiry', 'daysRemaining'],
    batchno: ['batchNo', 'batchNumber'],
    serialimei: ['serialImei', 'serialNo', 'imei', 'serial'],
    fromwarehouse: ['fromWarehouseName', 'fromWarehouse'],
    towarehouse: ['toWarehouseName', 'toWarehouse'],
    withdrawalamount: ['withdrawalAmount', 'debit'],
    depositamount: ['depositAmount', 'credit'],
    description: ['description', 'note', 'notes'],
    gstinuin: ['gstin', 'gstNumber', 'gstinUin'],
    taxableamount: ['taxableAmount', 'taxableValue'],
    transactiontype: ['transactionType', 'type'],
    invoiceno: ['invoiceNo', 'purchaseNo', 'saleNo'],
    invoicevalue: ['invoiceValue', 'grandTotal', 'totalAmount'],
    taxrate: ['taxRate', 'taxPercent', 'taxPercentage'],
    taxablevalue: ['taxableValue', 'taxableAmount'],
    cgst: ['cgst', 'cgstAmount'],
    sgst: ['sgst', 'sgstAmount'],
    igst: ['igst', 'igstAmount'],
    createdby: ['createdBy', 'userName'],
    withdrawal: ['withdrawalAmount', 'debit'],
    deposit: ['depositAmount', 'credit'],
  };
  for (const key of aliases[normalized] || []) {
    if (row?.[key] !== undefined && row?.[key] !== null) return typeof row[key] === 'object' ? row[key]?.name || '' : row[key];
  }
  return '';
};

const exportRows = (columns: string[], rows: any[]) => rows.map((row) => columns.map((column) => String(valueByColumn(row, column) ?? '')));

const exportData = (title: string, columns: string[], rows: any[], extension: 'csv' | 'xls') => {
  const separator = extension === 'csv' ? ',' : '\t';
  const content = [columns, ...exportRows(columns, rows)].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(separator)).join('\n');
  const blob = new Blob([content], { type: extension === 'csv' ? 'text/csv' : 'application/vnd.ms-excel' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${title.toLowerCase().replaceAll(' ', '-')}.${extension}`;
  link.click();
  URL.revokeObjectURL(url);
};

const configs: Record<ReportKey, ReportConfig> = {
  batch: {
    title: 'Batch Transaction Report',
    fields: [
      { key: 'fromDate', label: 'From Date', type: 'date' },
      { key: 'toDate', label: 'To Date', type: 'date' },
      { key: 'itemName', label: 'Item Name', type: 'select', placeholder: 'Select Item' },
      { key: 'brand', label: 'Brand', type: 'select', placeholder: 'Select Brand' },
      { key: 'batchNo', label: 'Batch Number', type: 'select', placeholder: 'Select Item' },
      { key: 'warehouse', label: 'Warehouse', type: 'select', placeholder: 'Select Warehouse' },
    ],
    columns: ['#', 'DATE', 'TYPE', 'INVOICE/REFERENCE NO.', 'PARTY NAME', 'WAREHOUSE', 'ITEM NAME', 'BRAND', 'BATCH NO.', 'QUANTITY', 'STOCK'],
    fetch: (filters) => reportsApi.itemTransactionsBatch({
      fromDate: formatDateForApi(filters.fromDate),
      toDate: formatDateForApi(filters.toDate),
      itemId: filters.itemName || undefined,
      brandId: filters.brand || undefined,
      batchNo: filters.batchNo || undefined,
      warehouseId: filters.warehouse || undefined,
    }),
  },
  serial: {
    title: 'Serial Transaction Report',
    fields: [
      { key: 'fromDate', label: 'From Date', type: 'date' },
      { key: 'toDate', label: 'To Date', type: 'date' },
      { key: 'itemName', label: 'Item Name', type: 'select', placeholder: 'Select Item' },
      { key: 'brand', label: 'Brand', type: 'select', placeholder: 'Select Brand' },
      { key: 'serial', label: 'Serial/IMEI', type: 'select', placeholder: 'Select Serial/IMEI' },
      { key: 'warehouse', label: 'Warehouse', type: 'select', placeholder: 'Select Warehouse' },
    ],
    columns: ['#', 'DATE', 'TYPE', 'INVOICE/REFERENCE NO.', 'PARTY NAME', 'WAREHOUSE', 'ITEM NAME', 'BRAND', 'SERIAL/IMEI'],
    fetch: (filters) => reportsApi.itemTransactionsSerial({
      fromDate: formatDateForApi(filters.fromDate),
      toDate: formatDateForApi(filters.toDate),
      itemId: filters.itemName || undefined,
      brandId: filters.brand || undefined,
      serialImei: filters.serial || undefined,
      warehouseId: filters.warehouse || undefined,
    }),
  },
  general: {
    title: 'General Transaction Report',
    fields: [
      { key: 'fromDate', label: 'From Date', type: 'date' },
      { key: 'toDate', label: 'To Date', type: 'date' },
      { key: 'itemName', label: 'Item Name', type: 'select', placeholder: 'Select Item' },
      { key: 'brand', label: 'Brand', type: 'select', placeholder: 'Select Brand' },
      { key: 'warehouse', label: 'Warehouse', type: 'select', placeholder: 'Select Warehouse' },
    ],
    columns: ['#', 'DATE', 'TYPE', 'INVOICE/REFERENCE NO.', 'PARTY NAME', 'WAREHOUSE', 'ITEM NAME', 'BRAND', 'QUANTITY', 'STOCK IMPACT'],
    fetch: (filters) => reportsApi.itemTransactionsGeneral({
      fromDate: formatDateForApi(filters.fromDate),
      toDate: formatDateForApi(filters.toDate),
      itemId: filters.itemName || undefined,
      brandId: filters.brand || undefined,
      warehouseId: filters.warehouse || undefined,
    }),
  },
  purchase: {
    title: 'Purchase Report',
    fields: [
      { key: 'fromDate', label: 'From Date', type: 'date' },
      { key: 'toDate', label: 'To Date', type: 'date' },
      { key: 'supplier', label: 'Supplier', type: 'select', placeholder: 'Select Supplier' },
    ],
    columns: ['#', 'DATE', 'INVOICE/REFERENCE NO.', 'SUPPLIER', 'GRAND TOTAL', 'PAID AMOUNT', 'BALANCE'],
    fetch: (filters) => reportsApi.purchases({ fromDate: formatDateForApi(filters.fromDate), toDate: formatDateForApi(filters.toDate) }),
  },
  itemPurchase: {
    title: 'Item Purchase Report',
    fields: [
      { key: 'fromDate', label: 'From Date', type: 'date' },
      { key: 'toDate', label: 'To Date', type: 'date' },
      { key: 'supplier', label: 'Supplier', type: 'select', placeholder: 'Select Supplier' },
      { key: 'itemName', label: 'Item Name', type: 'select', placeholder: 'Select Item' },
      { key: 'brand', label: 'Brand', type: 'select', placeholder: 'Select Brand' },
      { key: 'warehouse', label: 'Warehouse', type: 'select', placeholder: 'Select Warehouse' },
    ],
    columns: ['#', 'DATE', 'INVOICE/REFERENCE NO.', 'SUPPLIER', 'WAREHOUSE', 'ITEM NAME', 'BRAND', 'UNIT PRICE', 'QUANTITY', 'DISCOUNT AMOUNT'],
    fetch: (filters) => reportsApi.purchases({ fromDate: formatDateForApi(filters.fromDate), toDate: formatDateForApi(filters.toDate) }),
  },
  purchasePayment: {
    title: 'Purchase Payment Report',
    fields: [
      { key: 'fromDate', label: 'From Date', type: 'date' },
      { key: 'toDate', label: 'To Date', type: 'date' },
      { key: 'supplier', label: 'Supplier', type: 'select', placeholder: 'Select Supplier' },
      { key: 'paymentType', label: 'Payment Type', type: 'select', placeholder: 'Select Supplier' },
    ],
    columns: ['#', 'DATE', 'INVOICE/REFERENCE NO.', 'SUPPLIER', 'PAYMENT TYPE', 'PAID AMOUNT'],
    fetch: (filters) => reportsApi.purchasePayments({
      fromDate: formatDateForApi(filters.fromDate),
      toDate: formatDateForApi(filters.toDate),
      supplierId: filters.supplier || undefined,
      paymentMethodId: filters.paymentType || undefined,
    }),
  },
  sale: {
    title: 'Sale Report',
    fields: [
      { key: 'fromDate', label: 'From Date', type: 'date' },
      { key: 'toDate', label: 'To Date', type: 'date' },
      { key: 'customer', label: 'Customer', type: 'select', placeholder: 'Select Customer' },
    ],
    columns: ['#', 'DATE', 'INVOICE/REFERENCE NO.', 'CUSTOMER', 'GRAND TOTAL', 'PAID AMOUNT', 'BALANCE'],
    fetch: (filters) => reportsApi.sales({ fromDate: formatDateForApi(filters.fromDate), toDate: formatDateForApi(filters.toDate) }),
  },
  itemSale: {
    title: 'Item Sale Report',
    fields: [
      { key: 'fromDate', label: 'From Date', type: 'date' },
      { key: 'toDate', label: 'To Date', type: 'date' },
      { key: 'customer', label: 'Customer', type: 'select', placeholder: 'Select Customer' },
      { key: 'itemName', label: 'Item Name', type: 'select', placeholder: 'Select Item' },
      { key: 'brand', label: 'Brand', type: 'select', placeholder: 'Select Brand' },
      { key: 'warehouse', label: 'Warehouse', type: 'select', placeholder: 'Select Warehouse' },
    ],
    columns: ['#', 'DATE', 'INVOICE/REFERENCE NO.', 'CUSTOMER', 'WAREHOUSE', 'ITEM NAME', 'BRAND', 'UNIT PRICE', 'QUANTITY', 'DISCOUNT AMOUNT'],
    fetch: (filters) => reportsApi.sales({ fromDate: formatDateForApi(filters.fromDate), toDate: formatDateForApi(filters.toDate) }),
  },
  salePayment: {
    title: 'Sale Payment Report',
    fields: [
      { key: 'fromDate', label: 'From Date', type: 'date' },
      { key: 'toDate', label: 'To Date', type: 'date' },
      { key: 'customer', label: 'Customer', type: 'select', placeholder: 'Select Customer' },
      { key: 'paymentType', label: 'Payment Type', type: 'select', placeholder: 'Select Supplier' },
    ],
    columns: ['#', 'DATE', 'INVOICE/REFERENCE NO.', 'CUSTOMER', 'PAYMENT TYPE', 'PAID AMOUNT'],
    fetch: (filters) => reportsApi.salePayments({
      fromDate: formatDateForApi(filters.fromDate),
      toDate: formatDateForApi(filters.toDate),
      customerId: filters.customer || undefined,
      paymentMethodId: filters.paymentType || undefined,
    }),
  },
  customerDue: {
    title: 'Customer Due Payment Report',
    fields: [{ key: 'customer', label: 'Customer', type: 'select', placeholder: 'Select Customer' }],
    columns: ['#', 'CUSTOMER', 'DUE PAYMENT', 'PAYMENT STATUS'],
    fetch: (filters) => reportsApi.customerDues({ customerId: filters.customer || undefined }),
  },
  supplierDue: {
    title: 'Supplier Due Payment Report',
    fields: [{ key: 'supplier', label: 'Supplier', type: 'select', placeholder: 'Select Supplier' }],
    columns: ['#', 'SUPPLIER', 'DUE PAYMENT', 'PAYMENT STATUS'],
    fetch: (filters) => reportsApi.supplierDues({ supplierId: filters.supplier || undefined }),
  },
  expense: {
    title: 'Expense Report',
    fields: [
      { key: 'fromDate', label: 'From Date', type: 'date' },
      { key: 'toDate', label: 'To Date', type: 'date' },
      { key: 'category', label: 'Category', type: 'select', placeholder: 'Choose one thing' },
      { key: 'subcategory', label: 'Subcategory', type: 'select', placeholder: 'Choose one thing' },
    ],
    columns: ['#', 'DATE', 'REFERENCE NO.', 'CATEGORY', 'SUBCATEGORY', 'GRAND TOTAL', 'PAID AMOUNT', 'BALANCE'],
    fetch: () => expenseApi.getAll({ page: 0, size: 100 }),
  },
  expenseItem: {
    title: 'Expense Item Report',
    fields: [
      { key: 'fromDate', label: 'From Date', type: 'date' },
      { key: 'toDate', label: 'To Date', type: 'date' },
      { key: 'category', label: 'Category', type: 'select', placeholder: 'Choose one thing' },
      { key: 'subcategory', label: 'Subcategory', type: 'select', placeholder: 'Choose one thing' },
      { key: 'expenseItem', label: 'Expense Item', type: 'select', placeholder: 'Select Item' },
    ],
    columns: ['#', 'DATE', 'EXPENSE CODE', 'ITEM NAME', 'CATEGORY', 'SUBCATEGORY', 'UNIT PRICE', 'QUANTITY', 'TOTAL'],
    fetch: (filters) => reportsApi.expenseItems({
      fromDate: formatDateForApi(filters.fromDate),
      toDate: formatDateForApi(filters.toDate),
      categoryId: filters.category || undefined,
    }),
  },
  expensePayment: {
    title: 'Expense Payment Report',
    fields: [
      { key: 'fromDate', label: 'From Date', type: 'date' },
      { key: 'toDate', label: 'To Date', type: 'date' },
      { key: 'category', label: 'Category', type: 'select', placeholder: 'Choose one thing' },
      { key: 'subcategory', label: 'Subcategory', type: 'select', placeholder: 'Choose one thing' },
      { key: 'paymentType', label: 'Payment Type', type: 'select', placeholder: 'Select Supplier' },
    ],
    columns: ['#', 'DATE', 'EXPENSE CODE', 'CATEGORY', 'SUBCATEGORY', 'PAYMENT TYPE', 'PAID AMOUNT'],
    fetch: (filters) => reportsApi.expensePayments({
      fromDate: formatDateForApi(filters.fromDate),
      toDate: formatDateForApi(filters.toDate),
      categoryId: filters.category || undefined,
      paymentMethodId: filters.paymentType || undefined,
    }),
  },
  cashFlow: {
    title: 'Cash flow',
    fields: [
      { key: 'fromDate', label: 'From Date', type: 'date' },
      { key: 'toDate', label: 'To Date', type: 'date' },
    ],
    columns: ['#', 'DATE', 'TYPE', 'PARTY NAME', 'DESCRIPTION', 'WITHDRAWAL AMOUNT', 'DEPOSIT AMOUNT', 'BALANCE'],
    fetch: () => cashApi.getTransactions(),
  },
  bankStatement: {
    title: 'Bank Statement',
    fields: [
      { key: 'fromDate', label: 'From Date', type: 'date' },
      { key: 'toDate', label: 'To Date', type: 'date' },
      { key: 'bankAccount', label: 'Bank Account', type: 'select', placeholder: 'Select Bank Account' },
    ],
    columns: ['#', 'DATE', 'DESCRIPTION', 'WITHDRAWAL AMOUNT', 'DEPOSIT AMOUNT', 'BALANCE'],
    fetch: (filters) => reportsApi.bankStatement({
      fromDate: formatDateForApi(filters.fromDate),
      toDate: formatDateForApi(filters.toDate),
      bankAccountId: filters.bankAccount || undefined,
    }),
  },
  supplierLedger: {
    title: 'Supplier Ledger Report',
    fields: [{ key: 'supplierId', label: 'Supplier ID', type: 'number', placeholder: 'Enter Supplier ID' }],
    columns: ['#', 'DATE', 'TYPE', 'INVOICE/REFERENCE NO.', 'SUPPLIER', 'DEBIT', 'CREDIT', 'BALANCE'],
    fetch: (filters) => reportsApi.supplierLedger(Number(filters.supplierId || 0)),
  },
  customerLedger: {
    title: 'Customer Ledger Report',
    fields: [{ key: 'customerId', label: 'Customer ID', type: 'number', placeholder: 'Enter Customer ID' }],
    columns: ['#', 'DATE', 'TYPE', 'INVOICE/REFERENCE NO.', 'CUSTOMER', 'DEBIT', 'CREDIT', 'BALANCE'],
    fetch: (filters) => reportsApi.customerLedger(Number(filters.customerId || 0)),
  },
  gst: {
    title: 'GST Report',
    fields: [
      { key: 'fromDate', label: 'From Date', type: 'date' },
      { key: 'toDate', label: 'To Date', type: 'date' },
    ],
    columns: ['#', 'DATE', 'INVOICE/REFERENCE NO.', 'PARTY NAME', 'GSTIN', 'TAXABLE AMOUNT', 'TAX AMOUNT', 'TOTAL'],
    fetch: (filters) => reportsApi.gst({ fromDate: formatDateForApi(filters.fromDate), toDate: formatDateForApi(filters.toDate) }),
  },
  gstr1: {
    title: 'GSTR-1 Report',
    fields: [
      { key: 'fromDate', label: 'From Date', type: 'date' },
      { key: 'toDate', label: 'To Date', type: 'date' },
    ],
    columns: ['#', 'GSTIN/UIN', 'PARTY NAME', 'TRANSACTION TYPE', 'INVOICE NO.', 'DATE', 'INVOICE VALUE', 'TAX RATE', 'TAXABLE VALUE', 'CGST', 'SGST', 'IGST'],
    fetch: (filters) => reportsApi.gst({ fromDate: formatDateForApi(filters.fromDate), toDate: formatDateForApi(filters.toDate) }),
  },
  gstr2: {
    title: 'GSTR-2 Report',
    fields: [
      { key: 'fromDate', label: 'From Date', type: 'date' },
      { key: 'toDate', label: 'To Date', type: 'date' },
    ],
    columns: ['#', 'GSTIN/UIN', 'PARTY NAME', 'TRANSACTION TYPE', 'INVOICE NO.', 'DATE', 'INVOICE VALUE', 'TAX RATE', 'TAXABLE VALUE', 'CGST', 'SGST', 'IGST'],
    fetch: (filters) => reportsApi.gst({ fromDate: formatDateForApi(filters.fromDate), toDate: formatDateForApi(filters.toDate) }),
  },
  stockTransfer: {
    title: 'Stock Transfer Report',
    fields: [
      { key: 'fromDate', label: 'From Date', type: 'date' },
      { key: 'toDate', label: 'To Date', type: 'date' },
    ],
    columns: ['#', 'TRANSFER CODE', 'DATE', 'CREATED BY'],
    fetch: () => stockTransferApi.getAll({ page: 0, size: 100 }),
  },
  itemStockTransfer: {
    title: 'Item Stock Transfer Report',
    fields: [
      { key: 'fromDate', label: 'From Date', type: 'date' },
      { key: 'toDate', label: 'To Date', type: 'date' },
      { key: 'fromWarehouse', label: 'From Warehouse', type: 'select', placeholder: 'Select Warehouse' },
      { key: 'toWarehouse', label: 'To Warehouse', type: 'select', placeholder: 'Select Warehouse' },
      { key: 'itemName', label: 'Item Name', type: 'select', placeholder: 'Select Item' },
      { key: 'brand', label: 'Brand', type: 'select', placeholder: 'Select Brand' },
    ],
    columns: ['#', 'TRANSFER CODE', 'DATE', 'FROM WAREHOUSE', 'TO WAREHOUSE', 'ITEM NAME', 'BRAND', 'SERIAL/IMEI NUMBER', 'BATCH NO.', 'QUANTITY'],
    fetch: () => stockTransferApi.getAll({ page: 0, size: 100 }),
  },
  stockAdjustment: {
    title: 'Stock Adjustment Report',
    fields: [
      { key: 'fromDate', label: 'From Date', type: 'date' },
      { key: 'toDate', label: 'To Date', type: 'date' },
    ],
    columns: ['#', 'DATE', 'ADJUSTMENT CODE', 'REFERENCE NO.', 'CREATED BY'],
    fetch: () => stockAdjustmentApi.getAll({ page: 0, size: 100 }),
  },
  itemStockAdjustment: {
    title: 'Item Stock Adjustment Report',
    fields: [
      { key: 'fromDate', label: 'From Date', type: 'date' },
      { key: 'toDate', label: 'To Date', type: 'date' },
      { key: 'warehouse', label: 'Warehouse', type: 'select', placeholder: 'Select Warehouse' },
      { key: 'itemName', label: 'Item Name', type: 'select', placeholder: 'Select Item' },
      { key: 'brand', label: 'Brand', type: 'select', placeholder: 'Select Brand' },
    ],
    columns: ['#', 'ADJUSTMENT CODE', 'DATE', 'WAREHOUSE', 'ITEM NAME', 'BRAND', 'SERIAL/IMEI NUMBER', 'BATCH NO.', 'QUANTITY', 'UNIT', 'ACTION'],
    fetch: () => stockAdjustmentApi.getAll({ page: 0, size: 100 }),
  },
  stock: {
    title: 'Stock Report',
    fields: [],
    columns: ['#', 'ITEM NAME', 'BRAND', 'WAREHOUSE', 'QUANTITY', 'STOCK', 'UNIT PRICE', 'TOTAL'],
    fetch: () => reportsApi.stocks(),
  },
  stockBatch: {
    title: 'Batch Wise Item Stock Report',
    fields: [
      { key: 'itemName', label: 'Item Name', type: 'select', placeholder: 'Select Item' },
      { key: 'brand', label: 'Brand', type: 'select', placeholder: 'Select Brand' },
      { key: 'batchNo', label: 'Batch Number', type: 'select', placeholder: 'Select Item' },
      { key: 'warehouse', label: 'Warehouse', type: 'select', placeholder: 'Select Warehouse' },
    ],
    columns: ['#', 'WAREHOUSE', 'ITEM NAME', 'BRAND', 'BATCH NO.', 'DAYS UNTIL EXPIRY', 'AVAILABLE QTY'],
    fetch: () => reportsApi.stocks(),
  },
  stockSerial: {
    title: 'Serial/IMEI Item Stock Report',
    fields: [
      { key: 'itemName', label: 'Item Name', type: 'select', placeholder: 'Select Item' },
      { key: 'brand', label: 'Brand', type: 'select', placeholder: 'Select Brand' },
      { key: 'serial', label: 'Serial/IMEI', type: 'select', placeholder: 'Select Serial/IMEI' },
      { key: 'warehouse', label: 'Warehouse', type: 'select', placeholder: 'Select Warehouse' },
    ],
    columns: ['#', 'WAREHOUSE', 'ITEM NAME', 'BRAND', 'SERIAL/IMEI'],
    fetch: () => reportsApi.stocks(),
  },
  stockGeneral: {
    title: 'General Item Stock Report',
    fields: [
      { key: 'itemName', label: 'Item Name', type: 'select', placeholder: 'Select Item' },
      { key: 'brand', label: 'Brand', type: 'select', placeholder: 'Select Brand' },
      { key: 'category', label: 'Category', type: 'select', placeholder: 'Choose one thing' },
      { key: 'warehouse', label: 'Warehouse', type: 'select', placeholder: 'Select Warehouse' },
    ],
    columns: ['#', 'WAREHOUSE', 'ITEM CODE', 'ITEM NAME', 'BRAND', 'CATEGORY', 'PURCHASE PRICE', 'SALE PRICE', 'QUANTITY', 'UNIT', 'STOCK VALUE'],
    fetch: () => reportsApi.stocks(),
  },
  lowStock: {
    title: 'Low Stock Report',
    fields: [],
    columns: ['#', 'ITEM NAME', 'BRAND', 'WAREHOUSE', 'QUANTITY', 'MINIMUM STOCK', 'STATUS'],
    fetch: () => reportsApi.lowStock(),
  },
  inventory: {
    title: 'Inventory Valuation Report',
    fields: [],
    columns: ['#', 'ITEM NAME', 'BRAND', 'WAREHOUSE', 'QUANTITY', 'WORTH (COST)', 'WORTH (SALE)', 'WORTH (PROFIT)'],
    fetch: () => reportsApi.inventoryValuation(),
  },
  topSelling: {
    title: 'Top Selling Items Report',
    fields: [],
    columns: ['#', 'ITEM NAME', 'BRAND', 'QUANTITY', 'TOTAL SALE', 'GRAND TOTAL'],
    fetch: () => reportsApi.topSellingItems(),
  },
  dayBook: {
    title: 'Day Book Report',
    fields: [{ key: 'date', label: 'Date', type: 'date' }],
    columns: ['#', 'DATE', 'TYPE', 'INVOICE/REFERENCE NO.', 'PARTY NAME', 'AMOUNT', 'NOTE'],
    fetch: (filters) => reportsApi.dayBook({ date: formatDateForApi(filters.date) }),
  },
  expiredItem: {
    title: 'Expired Item Report',
    fields: [
      { key: 'filterType', label: 'Filter Type', type: 'radio', options: [
        { label: 'Use Date', value: 'useDate' },
        { label: 'Expired Till Date', value: 'expiredTillDate' },
        { label: 'Days Remaining to Expire', value: 'daysRemaining' },
      ] },
      { key: 'fromDate', label: 'From Date', type: 'date' },
      { key: 'toDate', label: 'To Date', type: 'date' },
      { key: 'itemName', label: 'Item Name', type: 'select', placeholder: 'Select Item' },
      { key: 'brand', label: 'Brand', type: 'select', placeholder: 'Select Brand' },
      { key: 'batchNo', label: 'Batch Number', type: 'select', placeholder: 'Select Item' },
      { key: 'warehouse', label: 'Warehouse', type: 'select', placeholder: 'Select Warehouse' },
    ],
    columns: ['#', 'WAREHOUSE', 'ITEM NAME', 'BRAND', 'BATCH NO.', 'DAYS UNTIL EXPIRY', 'QUANTITY'],
    fetch: (filters) => reportsApi.expiredItems({
      filterType: filters.filterType,
      fromDate: formatDateForApi(filters.fromDate),
      toDate: formatDateForApi(filters.toDate),
      itemId: filters.itemName || undefined,
      brandId: filters.brand || undefined,
      batchNo: filters.batchNo || undefined,
      warehouseId: filters.warehouse || undefined,
    }),
  },
  reorderItem: {
    title: 'Reorder Item Report',
    fields: [
      { key: 'category', label: 'Category', type: 'select', placeholder: 'General' },
      { key: 'itemName', label: 'Item Name', type: 'select', placeholder: 'Select Item' },
      { key: 'brand', label: 'Brand', type: 'select', placeholder: 'Select Brand' },
    ],
    columns: ['#', 'ITEM NAME', 'BRAND', 'CATEGORY', 'MINIMUM STOCK', 'CURRENT STOCK', 'UNIT'],
    fetch: () => reportsApi.lowStock(),
  },
};

const initialFilters = (config: ReportConfig) => Object.fromEntries((config.fields || []).map((field) => [
  field.key,
  field.type === 'date' ? (field.key === 'toDate' ? defaultTo : defaultFrom) : field.type === 'radio' ? field.options?.[0]?.value || '' : '',
]));

const useLookupOptions = () => {
  const customers = useQuery({ queryKey: ['report-lookup', 'customers'], queryFn: () => customerApi.getAll({ page: 0, size: 100 }) });
  const suppliers = useQuery({ queryKey: ['report-lookup', 'suppliers'], queryFn: () => supplierApi.getAll({ page: 0, size: 100 }) });
  const items = useQuery({ queryKey: ['report-lookup', 'items'], queryFn: () => itemApi.getAll({ page: 0, size: 100 }) });
  const brands = useQuery({ queryKey: ['report-lookup', 'brands'], queryFn: () => brandApi.getAll({ page: 0, size: 100 }) });
  const categories = useQuery({ queryKey: ['report-lookup', 'categories'], queryFn: () => categoryApi.getAll({ page: 0, size: 100 }) });
  const expenseSubCategories = useQuery({ queryKey: ['report-lookup', 'expense-subcategories'], queryFn: () => expenseSubCategoryApi.getAll() });
  const warehouses = useQuery({ queryKey: ['report-lookup', 'warehouses'], queryFn: () => warehouseApi.getAll() });
  const paymentMethods = useQuery({ queryKey: ['report-lookup', 'payment-methods'], queryFn: () => paymentMethodApi.getAll() });
  const bankAccounts = useQuery({ queryKey: ['report-lookup', 'bank-accounts'], queryFn: () => bankAccountApi.getAll() });

  return useMemo(() => {
    const warehouseOptions = (warehouses.data?.data || []).map((warehouse) => ({ value: String(warehouse.id), label: warehouse.name }));
    return {
      customer: (customers.data?.data?.content || []).map((customer) => ({ value: String(customer.id), label: customer.customerName })),
      supplier: (suppliers.data?.data?.content || []).map((supplier) => ({ value: String(supplier.id), label: supplier.supplierName })),
      itemName: (items.data?.data?.content || []).map((item) => ({ value: String(item.id), label: item.itemName })),
      brand: (brands.data?.data?.content || []).map((brand) => ({ value: String(brand.id), label: brand.name })),
      category: (categories.data?.data?.content || []).map((category) => ({ value: String(category.id), label: category.name })),
      subcategory: (expenseSubCategories.data?.data?.content || []).map((subCategory: any) => ({ value: String(subCategory.id), label: subCategory.name })),
      warehouse: warehouseOptions,
      fromWarehouse: warehouseOptions,
      toWarehouse: warehouseOptions,
      paymentType: (paymentMethods.data?.data?.content || []).map((method: any) => ({ value: String(method.id), label: method.name })),
      bankAccount: (bankAccounts.data?.data?.content || []).map((account: any) => ({ value: String(account.id), label: account.bankName ? `${account.bankName} - ${account.accountName}` : account.accountName })),
    } as Record<string, Array<{ value: string; label: string }>>;
  }, [
    customers.data,
    suppliers.data,
    items.data,
    brands.data,
    categories.data,
    expenseSubCategories.data,
    warehouses.data,
    paymentMethods.data,
    bankAccounts.data,
  ]);
};

export const ReportPage: React.FC<{ report: ReportKey }> = ({ report }) => {
  const config = configs[report];
  const [filters, setFilters] = useState<Record<string, string>>(() => initialFilters(config));
  const [submittedFilters, setSubmittedFilters] = useState<Record<string, string> | null>(config.fields?.length ? null : filters);
  const lookupOptions = useLookupOptions();
  const rowsQuery = useQuery({
    queryKey: ['report', report, submittedFilters],
    queryFn: () => config.fetch(submittedFilters || filters),
    enabled: Boolean(submittedFilters),
  });
  const rows = useMemo(() => unwrapRows(rowsQuery.data), [rowsQuery.data]);

  const submit = () => {
    if (['supplierLedger', 'customerLedger'].includes(report)) {
      const key = report === 'supplierLedger' ? 'supplierId' : 'customerId';
      if (!Number(filters[key])) {
        toast.error(`${report === 'supplierLedger' ? 'Supplier' : 'Customer'} ID is required`);
        return;
      }
    }
    setSubmittedFilters({ ...filters });
  };

  const close = () => {
    const reset = initialFilters(config);
    setFilters(reset);
    setSubmittedFilters(config.fields?.length ? null : reset);
  };

  return (
    <div className="space-y-6">
      <div className="text-sm text-gray-500">Home &gt; Reports &gt; {config.title}</div>
      {(config.fields || []).length > 0 && (
        <div className="overflow-hidden rounded-lg bg-white shadow">
          <div className="border-b px-5 py-4">
            <h1 className="text-xl font-semibold text-gray-900">{config.title}</h1>
          </div>
          <div className="grid grid-cols-1 gap-5 p-5 md:grid-cols-2">
            {config.fields?.map((field) => (
              <label key={field.key} className="text-sm text-gray-600">
                {field.label}
                {field.type === 'radio' ? (
                  <div className="mt-3 flex flex-wrap gap-4">
                    {(field.options || []).map((option) => (
                      <label key={option.value} className="flex items-center gap-2 text-sm font-medium text-gray-700">
                        <input type="radio" value={option.value} checked={(filters[field.key] || '') === option.value} onChange={(event) => setFilters((current) => ({ ...current, [field.key]: event.target.value }))} />
                        {option.label}
                      </label>
                    ))}
                  </div>
                ) : field.type === 'select' ? (
                  <select className={`${inputClass} mt-1`} value={filters[field.key] || ''} onChange={(event) => setFilters((current) => ({ ...current, [field.key]: event.target.value }))}>
                    <option value="">{field.placeholder || 'Choose one thing'}</option>
                    {(lookupOptions[field.key] || []).map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                ) : (
                  <input className={`${inputClass} mt-1`} type={field.type} placeholder={field.placeholder} value={filters[field.key] || ''} onChange={(event) => setFilters((current) => ({ ...current, [field.key]: event.target.value }))} />
                )}
              </label>
            ))}
          </div>
          <div className="flex gap-3 px-5 pb-5">
            <Button type="button" onClick={submit}>Submit</Button>
            <Button type="button" variant="secondary" onClick={close}>Close</Button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-lg bg-white shadow">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 className="text-xl font-semibold text-gray-900">Records</h2>
          <div className="flex">
            <button type="button" onClick={() => exportData(config.title, config.columns, rows, 'xls')} className="h-9 rounded-l border border-green-500 px-4 text-sm font-semibold text-green-600 hover:bg-green-50">Export</button>
            <button type="button" onClick={() => exportData(config.title, config.columns, rows, 'csv')} className="h-9 rounded-r border border-l-0 border-green-500 px-3 text-sm font-semibold text-green-600 hover:bg-green-50">v</button>
          </div>
        </div>
        <div className="overflow-x-auto p-5">
          {rowsQuery.isLoading ? (
            <div className="p-8"><Loader /></div>
          ) : (
            <table className="w-full min-w-[880px] text-sm">
              <thead>
                <tr>
                  {config.columns.map((column) => <th key={column} className="border bg-white p-3 text-left font-semibold text-gray-900">{column}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.length ? rows.map((row: any, index: number) => (
                  <tr key={index} className="border-b even:bg-gray-50">
                    {config.columns.map((column) => <td key={column} className="border p-3">{column === '#' ? index + 1 : String(valueByColumn(row, column) ?? '')}</td>)}
                  </tr>
                )) : (
                  <tr><td colSpan={config.columns.length} className="bg-gray-50 p-5 text-center">No data available in table</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};
