import type { ErpDatabase } from '@erp/db';
import {
  customers,
  suppliers,
  items,
  invoices,
  payments,
  inventoryLedger,
  projectionStockLevel,
  employees,
  warehouses,
  departments,
  designations,
} from '@erp/db';
import { eq, and, gte, lte, isNull, type SQL } from 'drizzle-orm';

export type ExportEntity =
  | 'customer'
  | 'supplier'
  | 'item'
  | 'invoice'
  | 'payment'
  | 'ledger'
  | 'stock'
  | 'employee';

export interface ExportColumn {
  key: string;
  label: string;
  type: 'string' | 'number' | 'currency' | 'date' | 'percent';
}

export interface ExportFilters {
  dateFrom?: string;
  dateTo?: string;
  status?: string;
  warehouseId?: number;
}

export interface ExportResult {
  columns: ExportColumn[];
  rows: Array<Record<string, unknown>>;
  totalRows: number;
}

// Bounds a single export to a sane single-shot upload size (Performance section, PG-009).
const MAX_EXPORT_ROWS = 50_000;

function parseFilters(raw: Record<string, unknown> | null | undefined): ExportFilters {
  if (!raw) return {};
  return {
    ...(typeof raw['dateFrom'] === 'string' ? { dateFrom: raw['dateFrom'] } : {}),
    ...(typeof raw['dateTo'] === 'string' ? { dateTo: raw['dateTo'] } : {}),
    ...(typeof raw['status'] === 'string' ? { status: raw['status'] } : {}),
    ...(typeof raw['warehouseId'] === 'number' ? { warehouseId: raw['warehouseId'] } : {}),
  };
}

const CUSTOMER_COLUMNS: ExportColumn[] = [
  { key: 'customerCode', label: 'Customer Code', type: 'string' },
  { key: 'displayName', label: 'Name', type: 'string' },
  { key: 'phone', label: 'Phone', type: 'string' },
  { key: 'email', label: 'Email', type: 'string' },
  { key: 'gstin', label: 'GSTIN', type: 'string' },
  { key: 'customerType', label: 'Type', type: 'string' },
  { key: 'creditLimit', label: 'Credit Limit', type: 'currency' },
  { key: 'openingBalance', label: 'Opening Balance', type: 'currency' },
  { key: 'status', label: 'Status', type: 'string' },
  { key: 'createdAt', label: 'Created At', type: 'date' },
];

const SUPPLIER_COLUMNS: ExportColumn[] = [
  { key: 'supplierCode', label: 'Supplier Code', type: 'string' },
  { key: 'displayName', label: 'Name', type: 'string' },
  { key: 'phone', label: 'Phone', type: 'string' },
  { key: 'email', label: 'Email', type: 'string' },
  { key: 'gstin', label: 'GSTIN', type: 'string' },
  { key: 'supplierType', label: 'Type', type: 'string' },
  { key: 'creditDays', label: 'Credit Days', type: 'number' },
  { key: 'creditLimit', label: 'Credit Limit', type: 'currency' },
  { key: 'openingBalance', label: 'Opening Balance', type: 'currency' },
  { key: 'status', label: 'Status', type: 'string' },
  { key: 'createdAt', label: 'Created At', type: 'date' },
];

const ITEM_COLUMNS: ExportColumn[] = [
  { key: 'itemCode', label: 'Item Code', type: 'string' },
  { key: 'name', label: 'Name', type: 'string' },
  { key: 'hsnCode', label: 'HSN Code', type: 'string' },
  { key: 'gstRate', label: 'GST Rate', type: 'percent' },
  { key: 'salePrice', label: 'Sale Price', type: 'currency' },
  { key: 'purchasePrice', label: 'Purchase Price', type: 'currency' },
  { key: 'mrp', label: 'MRP', type: 'currency' },
  { key: 'barcode', label: 'Barcode', type: 'string' },
  { key: 'createdAt', label: 'Created At', type: 'date' },
];

const INVOICE_COLUMNS: ExportColumn[] = [
  { key: 'invoiceNumber', label: 'Invoice Number', type: 'string' },
  { key: 'invoiceDate', label: 'Invoice Date', type: 'date' },
  { key: 'customerName', label: 'Customer', type: 'string' },
  { key: 'status', label: 'Status', type: 'string' },
  { key: 'subtotal', label: 'Subtotal', type: 'currency' },
  { key: 'taxableAmount', label: 'Taxable Amount', type: 'currency' },
  { key: 'cgstAmount', label: 'CGST', type: 'currency' },
  { key: 'sgstAmount', label: 'SGST', type: 'currency' },
  { key: 'igstAmount', label: 'IGST', type: 'currency' },
  { key: 'cessAmount', label: 'Cess', type: 'currency' },
  { key: 'grandTotal', label: 'Grand Total', type: 'currency' },
  { key: 'paidAmount', label: 'Paid Amount', type: 'currency' },
  { key: 'balanceDue', label: 'Balance Due', type: 'currency' },
];

const PAYMENT_COLUMNS: ExportColumn[] = [
  { key: 'paymentNumber', label: 'Payment Number', type: 'string' },
  { key: 'paymentDate', label: 'Payment Date', type: 'date' },
  { key: 'customerName', label: 'Customer', type: 'string' },
  { key: 'paymentMode', label: 'Mode', type: 'string' },
  { key: 'amount', label: 'Amount', type: 'currency' },
  { key: 'allocatedAmount', label: 'Allocated', type: 'currency' },
  { key: 'unallocatedAmount', label: 'Unallocated', type: 'currency' },
  { key: 'status', label: 'Status', type: 'string' },
];

const LEDGER_COLUMNS: ExportColumn[] = [
  { key: 'createdAt', label: 'Date', type: 'date' },
  { key: 'itemName', label: 'Item', type: 'string' },
  { key: 'warehouseName', label: 'Warehouse', type: 'string' },
  { key: 'movementType', label: 'Movement Type', type: 'string' },
  { key: 'quantity', label: 'Quantity', type: 'number' },
  { key: 'quantityBefore', label: 'Qty Before', type: 'number' },
  { key: 'quantityAfter', label: 'Qty After', type: 'number' },
  { key: 'unitCost', label: 'Unit Cost', type: 'currency' },
  { key: 'referenceType', label: 'Reference Type', type: 'string' },
  { key: 'referenceId', label: 'Reference ID', type: 'number' },
];

const STOCK_COLUMNS: ExportColumn[] = [
  { key: 'itemName', label: 'Item', type: 'string' },
  { key: 'warehouseName', label: 'Warehouse', type: 'string' },
  { key: 'availableQty', label: 'Available Qty', type: 'number' },
  { key: 'reservedQty', label: 'Reserved Qty', type: 'number' },
  { key: 'lastMovementAt', label: 'Last Movement', type: 'date' },
];

const EMPLOYEE_COLUMNS: ExportColumn[] = [
  { key: 'employeeCode', label: 'Employee Code', type: 'string' },
  { key: 'displayName', label: 'Name', type: 'string' },
  { key: 'phone', label: 'Phone', type: 'string' },
  { key: 'email', label: 'Email', type: 'string' },
  { key: 'departmentName', label: 'Department', type: 'string' },
  { key: 'designationName', label: 'Designation', type: 'string' },
  { key: 'employmentType', label: 'Employment Type', type: 'string' },
  { key: 'joiningDate', label: 'Joining Date', type: 'date' },
  { key: 'status', label: 'Status', type: 'string' },
];

export const ENTITY_COLUMNS: Record<ExportEntity, ExportColumn[]> = {
  customer: CUSTOMER_COLUMNS,
  supplier: SUPPLIER_COLUMNS,
  item: ITEM_COLUMNS,
  invoice: INVOICE_COLUMNS,
  payment: PAYMENT_COLUMNS,
  ledger: LEDGER_COLUMNS,
  stock: STOCK_COLUMNS,
  employee: EMPLOYEE_COLUMNS,
};

export class ExportEngine {
  constructor(private readonly db: ErpDatabase) {}

  async query(
    tenantId: number,
    entityType: ExportEntity,
    rawFilters?: Record<string, unknown> | null
  ): Promise<ExportResult> {
    const filters = parseFilters(rawFilters);
    const rows = await this.runQuery(tenantId, entityType, filters);
    return { columns: ENTITY_COLUMNS[entityType], rows, totalRows: rows.length };
  }

  private runQuery(
    tenantId: number,
    entityType: ExportEntity,
    filters: ExportFilters
  ): Promise<Array<Record<string, unknown>>> {
    switch (entityType) {
      case 'customer':
        return this.queryCustomers(tenantId);
      case 'supplier':
        return this.querySuppliers(tenantId);
      case 'item':
        return this.queryItems(tenantId);
      case 'invoice':
        return this.queryInvoices(tenantId, filters);
      case 'payment':
        return this.queryPayments(tenantId, filters);
      case 'ledger':
        return this.queryLedger(tenantId, filters);
      case 'stock':
        return this.queryStock(tenantId, filters);
      case 'employee':
        return this.queryEmployees(tenantId);
    }
  }

  private async queryCustomers(tenantId: number): Promise<Array<Record<string, unknown>>> {
    return this.db
      .select({
        customerCode: customers.customerCode,
        displayName: customers.displayName,
        phone: customers.phone,
        email: customers.email,
        gstin: customers.gstin,
        customerType: customers.customerType,
        creditLimit: customers.creditLimit,
        openingBalance: customers.openingBalance,
        status: customers.status,
        createdAt: customers.createdAt,
      })
      .from(customers)
      .where(and(eq(customers.tenantId, tenantId), isNull(customers.deletedAt)))
      .limit(MAX_EXPORT_ROWS);
  }

  private async querySuppliers(tenantId: number): Promise<Array<Record<string, unknown>>> {
    return this.db
      .select({
        supplierCode: suppliers.supplierCode,
        displayName: suppliers.displayName,
        phone: suppliers.phone,
        email: suppliers.email,
        gstin: suppliers.gstin,
        supplierType: suppliers.supplierType,
        creditDays: suppliers.creditDays,
        creditLimit: suppliers.creditLimit,
        openingBalance: suppliers.openingBalance,
        status: suppliers.status,
        createdAt: suppliers.createdAt,
      })
      .from(suppliers)
      .where(and(eq(suppliers.tenantId, tenantId), isNull(suppliers.deletedAt)))
      .limit(MAX_EXPORT_ROWS);
  }

  private async queryItems(tenantId: number): Promise<Array<Record<string, unknown>>> {
    return this.db
      .select({
        itemCode: items.itemCode,
        name: items.name,
        hsnCode: items.hsnCode,
        gstRate: items.gstRate,
        salePrice: items.salePrice,
        purchasePrice: items.purchasePrice,
        mrp: items.mrp,
        barcode: items.barcode,
        createdAt: items.createdAt,
      })
      .from(items)
      .where(and(eq(items.tenantId, tenantId), isNull(items.deletedAt)))
      .limit(MAX_EXPORT_ROWS);
  }

  private async queryInvoices(
    tenantId: number,
    filters: ExportFilters
  ): Promise<Array<Record<string, unknown>>> {
    const conditions: SQL[] = [eq(invoices.tenantId, tenantId)];
    if (filters.dateFrom) conditions.push(gte(invoices.invoiceDate, new Date(filters.dateFrom)));
    if (filters.dateTo) conditions.push(lte(invoices.invoiceDate, new Date(filters.dateTo)));
    if (filters.status) conditions.push(eq(invoices.status, filters.status as typeof invoices.$inferSelect.status));

    return this.db
      .select({
        invoiceNumber: invoices.invoiceNumber,
        invoiceDate: invoices.invoiceDate,
        customerName: customers.displayName,
        status: invoices.status,
        subtotal: invoices.subtotal,
        taxableAmount: invoices.taxableAmount,
        cgstAmount: invoices.cgstAmount,
        sgstAmount: invoices.sgstAmount,
        igstAmount: invoices.igstAmount,
        cessAmount: invoices.cessAmount,
        grandTotal: invoices.grandTotal,
        paidAmount: invoices.paidAmount,
        balanceDue: invoices.balanceDue,
      })
      .from(invoices)
      .leftJoin(customers, eq(customers.id, invoices.customerId))
      .where(and(...conditions))
      .limit(MAX_EXPORT_ROWS);
  }

  private async queryPayments(
    tenantId: number,
    filters: ExportFilters
  ): Promise<Array<Record<string, unknown>>> {
    const conditions: SQL[] = [eq(payments.tenantId, tenantId)];
    if (filters.dateFrom) conditions.push(gte(payments.paymentDate, new Date(filters.dateFrom)));
    if (filters.dateTo) conditions.push(lte(payments.paymentDate, new Date(filters.dateTo)));
    if (filters.status) conditions.push(eq(payments.status, filters.status as typeof payments.$inferSelect.status));

    return this.db
      .select({
        paymentNumber: payments.paymentNumber,
        paymentDate: payments.paymentDate,
        customerName: customers.displayName,
        paymentMode: payments.paymentMode,
        amount: payments.amount,
        allocatedAmount: payments.allocatedAmount,
        unallocatedAmount: payments.unallocatedAmount,
        status: payments.status,
      })
      .from(payments)
      .leftJoin(customers, eq(customers.id, payments.customerId))
      .where(and(...conditions))
      .limit(MAX_EXPORT_ROWS);
  }

  private async queryLedger(
    tenantId: number,
    filters: ExportFilters
  ): Promise<Array<Record<string, unknown>>> {
    const conditions: SQL[] = [eq(inventoryLedger.tenantId, tenantId)];
    if (filters.dateFrom) conditions.push(gte(inventoryLedger.createdAt, new Date(filters.dateFrom)));
    if (filters.dateTo) conditions.push(lte(inventoryLedger.createdAt, new Date(filters.dateTo)));
    if (filters.warehouseId !== undefined) conditions.push(eq(inventoryLedger.warehouseId, filters.warehouseId));

    return this.db
      .select({
        createdAt: inventoryLedger.createdAt,
        itemName: items.name,
        warehouseName: warehouses.name,
        movementType: inventoryLedger.movementType,
        quantity: inventoryLedger.quantity,
        quantityBefore: inventoryLedger.quantityBefore,
        quantityAfter: inventoryLedger.quantityAfter,
        unitCost: inventoryLedger.unitCost,
        referenceType: inventoryLedger.referenceType,
        referenceId: inventoryLedger.referenceId,
      })
      .from(inventoryLedger)
      .leftJoin(items, eq(items.id, inventoryLedger.itemId))
      .leftJoin(warehouses, eq(warehouses.id, inventoryLedger.warehouseId))
      .where(and(...conditions))
      .limit(MAX_EXPORT_ROWS);
  }

  private async queryStock(
    tenantId: number,
    filters: ExportFilters
  ): Promise<Array<Record<string, unknown>>> {
    const conditions: SQL[] = [eq(projectionStockLevel.tenantId, tenantId)];
    if (filters.warehouseId !== undefined) conditions.push(eq(projectionStockLevel.warehouseId, filters.warehouseId));

    return this.db
      .select({
        itemName: items.name,
        warehouseName: warehouses.name,
        availableQty: projectionStockLevel.availableQty,
        reservedQty: projectionStockLevel.reservedQty,
        lastMovementAt: projectionStockLevel.lastMovementAt,
      })
      .from(projectionStockLevel)
      .leftJoin(items, eq(items.id, projectionStockLevel.itemId))
      .leftJoin(warehouses, eq(warehouses.id, projectionStockLevel.warehouseId))
      .where(and(...conditions))
      .limit(MAX_EXPORT_ROWS);
  }

  private async queryEmployees(tenantId: number): Promise<Array<Record<string, unknown>>> {
    // PII fields (panEncrypted, bankAccountNoEncrypted, aadhaarLast4) are deliberately
    // excluded — this export has no payroll-data authorization scope of its own.
    return this.db
      .select({
        employeeCode: employees.employeeCode,
        displayName: employees.displayName,
        phone: employees.phone,
        email: employees.email,
        departmentName: departments.name,
        designationName: designations.name,
        employmentType: employees.employmentType,
        joiningDate: employees.joiningDate,
        status: employees.status,
      })
      .from(employees)
      .leftJoin(departments, eq(departments.id, employees.departmentId))
      .leftJoin(designations, eq(designations.id, employees.designationId))
      .where(and(eq(employees.tenantId, tenantId), isNull(employees.deletedAt)))
      .limit(MAX_EXPORT_ROWS);
  }
}
