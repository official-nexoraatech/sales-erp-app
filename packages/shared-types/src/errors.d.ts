export declare class ERPError extends Error {
    readonly code: string;
    readonly statusCode: number;
    readonly details?: Record<string, unknown> | undefined;
    constructor(code: string, message: string, statusCode?: number, details?: Record<string, unknown> | undefined);
}
export declare class ValidationError extends ERPError {
    constructor(message: string, field?: string);
}
export declare class NotFoundError extends ERPError {
    constructor(entity: string, id?: number | string);
}
export declare class PermissionError extends ERPError {
    constructor(permission: string);
}
export declare class BusinessError extends ERPError {
    constructor(code: string, message: string, details?: Record<string, unknown>);
}
export declare class InsufficientStockError extends BusinessError {
    constructor(itemId: number, requested: number, available: number);
}
export declare class CreditLimitExceededError extends BusinessError {
    constructor(customerId: number, creditLimit: number, newBalance: number);
}
export declare class OptimisticLockError extends ERPError {
    constructor(entity: string);
}
export declare class FinancialPeriodClosedError extends BusinessError {
    constructor(period: string);
}
export declare class SecurityError extends ERPError {
    constructor(message: string);
}
export declare class DuplicateInvoiceError extends BusinessError {
    constructor(invoiceNumber: string);
}
export declare class TenantSuspendedError extends ERPError {
    constructor(tenantId: number);
}
export declare class WorkflowApprovalRequiredError extends BusinessError {
    constructor(workflowType: string, entityId: number);
}
export declare class IdempotencyConflictError extends ERPError {
    constructor(idempotencyKey: string);
}
//# sourceMappingURL=errors.d.ts.map