import type { SearchEntity } from '../domain/SearchEngine.js';

export interface EventEntityMapping {
  entity: SearchEntity;
  // 'delete' events carry only enough payload to identify the row (usually just {id}) —
  // 'index' events upsert whatever fields the payload includes (see SearchEngine.index's
  // partial-update/doc_as_upsert behavior, which is what makes mixing full- and
  // partial-payload 'index' events for the same entity safe).
  op: 'index' | 'delete';
  // Needed only where one search entity is fed by more than one owning table with its own
  // independent numeric PK sequence — 'payment' is fed by both sales-service's customer
  // payments and purchase-service's supplier payments, so a bare `String(aggregateId)`
  // could collide (payment #5 from each side landing on the same ES doc id). Prefixing by
  // source keeps them distinct without needing a shared ID space across two services.
  idPrefix?: string;
}

// Maps every outbox event type this consumer subscribes to onto the search entity/index it
// affects. Adding a new searchable entity elsewhere: emit CREATED/UPDATED/DELETED (or
// equivalent) outbox events at the source, add its ES mapping in SearchEngine.ts, then add
// its event types here — nothing else in this consumer needs to change.
export const EVENT_ENTITY_MAP: Record<string, EventEntityMapping> = {
  // Customer
  CUSTOMER_CREATED: { entity: 'customer', op: 'index' },
  CUSTOMER_UPDATED: { entity: 'customer', op: 'index' },
  CUSTOMER_DELETED: { entity: 'customer', op: 'delete' },
  // Supplier
  SUPPLIER_CREATED: { entity: 'supplier', op: 'index' },
  SUPPLIER_UPDATED: { entity: 'supplier', op: 'index' },
  SUPPLIER_DELETED: { entity: 'supplier', op: 'delete' },
  // Item / catalog
  ITEM_CREATED: { entity: 'item', op: 'index' },
  ITEM_UPDATED: { entity: 'item', op: 'index' },
  ITEM_DELETED: { entity: 'item', op: 'delete' },
  CATEGORY_CREATED: { entity: 'category', op: 'index' },
  CATEGORY_UPDATED: { entity: 'category', op: 'index' },
  CATEGORY_DELETED: { entity: 'category', op: 'delete' },
  BRAND_CREATED: { entity: 'brand', op: 'index' },
  BRAND_UPDATED: { entity: 'brand', op: 'index' },
  BRAND_DELETED: { entity: 'brand', op: 'delete' },
  UNIT_CREATED: { entity: 'unit', op: 'index' },
  UNIT_UPDATED: { entity: 'unit', op: 'index' },
  WAREHOUSE_CREATED: { entity: 'warehouse', op: 'index' },
  WAREHOUSE_UPDATED: { entity: 'warehouse', op: 'index' },
  WAREHOUSE_DELETED: { entity: 'warehouse', op: 'delete' },
  // Stock
  TRANSFER_CREATED: { entity: 'stock_transfer', op: 'index' },
  TRANSFER_DISPATCHED: { entity: 'stock_transfer', op: 'index' },
  TRANSFER_RECEIVED: { entity: 'stock_transfer', op: 'index' },
  STOCK_ADJUSTMENT_CREATED: { entity: 'stock_adjustment', op: 'index' },
  STOCK_ADJUSTMENT_UPDATED: { entity: 'stock_adjustment', op: 'index' },
  // Sales
  INVOICE_CREATED: { entity: 'invoice', op: 'index' },
  INVOICE_CONFIRMED: { entity: 'invoice', op: 'index' },
  INVOICE_CANCELLED: { entity: 'invoice', op: 'index' },
  QUOTATION_CREATED: { entity: 'quotation', op: 'index' },
  QUOTATION_UPDATED: { entity: 'quotation', op: 'index' },
  QUOTATION_CONVERTED: { entity: 'quotation', op: 'index' },
  // CRM
  CRM_INTERACTION_CREATED: { entity: 'crm_interaction', op: 'index' },
  CRM_SEGMENT_CREATED: { entity: 'crm_segment', op: 'index' },
  CRM_CAMPAIGN_CREATED: { entity: 'crm_campaign', op: 'index' },
  CAMPAIGN_SENT: { entity: 'crm_campaign', op: 'index' },
  // Purchase
  PO_CREATED: { entity: 'purchase_order', op: 'index' },
  PO_APPROVED: { entity: 'purchase_order', op: 'index' },
  PO_AMENDED: { entity: 'purchase_order', op: 'index' },
  PO_CANCELLED: { entity: 'purchase_order', op: 'index' },
  GRN_CREATED: { entity: 'grn', op: 'index' },
  GRN_APPROVED: { entity: 'grn', op: 'index' },
  GRN_REJECTED: { entity: 'grn', op: 'index' },
  PURCHASE_RETURN_CREATED: { entity: 'purchase_return', op: 'index' },
  PURCHASE_RETURN_APPROVED: { entity: 'purchase_return', op: 'index' },
  // Accounting
  ACCOUNT_CREATED: { entity: 'account', op: 'index' },
  ACCOUNT_UPDATED: { entity: 'account', op: 'index' },
  ACCOUNT_DELETED: { entity: 'account', op: 'delete' },
  JOURNAL_POSTED: { entity: 'journal_entry', op: 'index' },
  JOURNAL_REVERSED: { entity: 'journal_entry', op: 'index' },
  PAYMENT_RECEIVED: { entity: 'payment', op: 'index', idPrefix: 'in-' },
  SUPPLIER_PAYMENT_MADE: { entity: 'payment', op: 'index', idPrefix: 'out-' },
  // HR
  EMPLOYEE_JOINED: { entity: 'employee', op: 'index' },
  EMPLOYEE_EXITED: { entity: 'employee', op: 'index' },
  ATTENDANCE_MARKED: { entity: 'attendance', op: 'index' },
  ATTENDANCE_CORRECTED: { entity: 'attendance', op: 'index' },
  PAYROLL_RUN_APPROVED: { entity: 'payroll_run', op: 'index' },
  PAYROLL_RUN_DISBURSED: { entity: 'payroll_run', op: 'index' },
  LEAVE_APPLIED: { entity: 'leave_application', op: 'index' },
  LEAVE_APPROVED: { entity: 'leave_application', op: 'index' },
  LEAVE_REJECTED: { entity: 'leave_application', op: 'index' },
  LEAVE_CANCELLED: { entity: 'leave_application', op: 'index' },
  // Auth / tenant admin
  USER_CREATED: { entity: 'user', op: 'index' },
  USER_UPDATED: { entity: 'user', op: 'index' },
  // A deactivated user shouldn't keep cluttering global search results — same treatment as
  // every other soft-delete event above, not a hard DB delete.
  USER_DEACTIVATED: { entity: 'user', op: 'delete' },
  ROLE_CREATED: { entity: 'role', op: 'index' },
  ROLE_UPDATED: { entity: 'role', op: 'index' },
  ROLE_DELETED: { entity: 'role', op: 'delete' },
  BRANCH_CREATED: { entity: 'branch', op: 'index' },
  BRANCH_UPDATED: { entity: 'branch', op: 'index' },
  BRANCH_DELETED: { entity: 'branch', op: 'delete' },
  ORGANIZATION_UPDATED: { entity: 'organization', op: 'index' },
  // Attachments
  ATTACHMENT_UPLOADED: { entity: 'attachment', op: 'index' },
  ATTACHMENT_DELETED: { entity: 'attachment', op: 'delete' },
};

// Kafka topic naming convention used by OutboxPublisher: erp.<event_type_lowercased_dotted>
export function topicForEventType(eventType: string): string {
  return `erp.${eventType.toLowerCase().replace(/_/g, '.')}`;
}

export const SEARCH_SYNC_TOPICS: string[] = Object.keys(EVENT_ENTITY_MAP).map(topicForEventType);
