export interface ERPEventPayload {
    eventId: string;
    eventType: string;
    schemaVersion: number;
    aggregateType: string;
    aggregateId: number;
    tenantId: number;
    userId: number;
    correlationId: string;
    causationId: string;
    occurredAt: string;
    payload: Record<string, unknown>;
}
export declare const EventTypes: {
    readonly INVOICE_CONFIRMED: "INVOICE_CONFIRMED";
    readonly INVOICE_CANCELLED: "INVOICE_CANCELLED";
    readonly INVOICE_PAYMENT_RECORDED: "INVOICE_PAYMENT_RECORDED";
    readonly QUOTATION_CREATED: "QUOTATION_CREATED";
    readonly QUOTATION_CONVERTED: "QUOTATION_CONVERTED";
    readonly SALE_RETURN_APPROVED: "SALE_RETURN_APPROVED";
    readonly CREDIT_NOTE_ISSUED: "CREDIT_NOTE_ISSUED";
    readonly STOCK_DEDUCTED: "STOCK_DEDUCTED";
    readonly STOCK_RECEIVED: "STOCK_RECEIVED";
    readonly RESERVATION_CREATED: "RESERVATION_CREATED";
    readonly RESERVATION_EXPIRED: "RESERVATION_EXPIRED";
    readonly RESERVATION_FULFILLED: "RESERVATION_FULFILLED";
    readonly STOCK_TRANSFER_INITIATED: "STOCK_TRANSFER_INITIATED";
    readonly STOCK_TRANSFER_COMPLETED: "STOCK_TRANSFER_COMPLETED";
    readonly STOCK_ADJUSTMENT_POSTED: "STOCK_ADJUSTMENT_POSTED";
    readonly CUSTOMER_CREATED: "CUSTOMER_CREATED";
    readonly CUSTOMER_CREDIT_LIMIT_CHANGED: "CUSTOMER_CREDIT_LIMIT_CHANGED";
    readonly CUSTOMER_BLOCKED: "CUSTOMER_BLOCKED";
    readonly GRN_APPROVED: "GRN_APPROVED";
    readonly PO_CREATED: "PO_CREATED";
    readonly PURCHASE_RETURN_APPROVED: "PURCHASE_RETURN_APPROVED";
    readonly PAYMENT_RECEIVED: "PAYMENT_RECEIVED";
    readonly PAYMENT_MADE: "PAYMENT_MADE";
    readonly CHEQUE_BOUNCED: "CHEQUE_BOUNCED";
    readonly EMPLOYEE_JOINED: "EMPLOYEE_JOINED";
    readonly PAYROLL_PROCESSED: "PAYROLL_PROCESSED";
    readonly LEAVE_APPROVED: "LEAVE_APPROVED";
    readonly JOURNAL_POSTED: "JOURNAL_POSTED";
    readonly FINANCIAL_YEAR_CLOSED: "FINANCIAL_YEAR_CLOSED";
    readonly EINVOICE_GENERATED: "EINVOICE_GENERATED";
    readonly EWAY_BILL_GENERATED: "EWAY_BILL_GENERATED";
    readonly TENANT_PROVISIONED: "TENANT_PROVISIONED";
    readonly TENANT_SUSPENDED: "TENANT_SUSPENDED";
};
export type EventType = (typeof EventTypes)[keyof typeof EventTypes];
export interface KafkaTopics {
    readonly INVOICE_CONFIRMED: 'erp.sales.invoice.confirmed';
    readonly INVOICE_CANCELLED: 'erp.sales.invoice.cancelled';
    readonly STOCK_DEDUCTED: 'erp.inventory.stock.deducted';
    readonly STOCK_RECEIVED: 'erp.inventory.stock.received';
    readonly JOURNAL_POSTED: 'erp.accounting.entry.posted';
    readonly EINVOICE_GENERATED: 'erp.gst.einvoice.generated';
    readonly PAYROLL_PROCESSED: 'erp.hr.payroll.processed';
}
//# sourceMappingURL=events.d.ts.map