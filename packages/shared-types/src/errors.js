export class ERPError extends Error {
    code;
    statusCode;
    details;
    constructor(code, message, statusCode = 500, details) {
        super(message);
        this.code = code;
        this.statusCode = statusCode;
        this.details = details;
        this.name = this.constructor.name;
    }
}
export class ValidationError extends ERPError {
    constructor(message, field) {
        super('VALIDATION_ERROR', message, 422, field !== undefined ? { field } : undefined);
    }
}
export class NotFoundError extends ERPError {
    constructor(entity, id) {
        super('NOT_FOUND', `${entity} not found${id !== undefined ? ` (id: ${id})` : ''}`, 404);
    }
}
export class PermissionError extends ERPError {
    constructor(permission) {
        super('PERMISSION_DENIED', `Missing permission: ${permission}`, 403);
    }
}
export class BusinessError extends ERPError {
    constructor(code, message, details) {
        super(code, message, 422, details);
    }
}
export class InsufficientStockError extends BusinessError {
    constructor(itemId, requested, available) {
        super('INSUFFICIENT_STOCK', 'Insufficient stock for the requested quantity', {
            itemId,
            requested,
            available,
        });
    }
}
export class CreditLimitExceededError extends BusinessError {
    constructor(customerId, creditLimit, newBalance) {
        super('CREDIT_LIMIT_EXCEEDED', 'Credit limit exceeded', {
            customerId,
            creditLimit,
            newBalance,
        });
    }
}
export class OptimisticLockError extends ERPError {
    constructor(entity) {
        super('OPTIMISTIC_LOCK_CONFLICT', `${entity} was modified by another user. Please refresh and retry.`, 409);
    }
}
export class FinancialPeriodClosedError extends BusinessError {
    constructor(period) {
        super('FINANCIAL_PERIOD_CLOSED', `Financial period ${period} is closed`, { period });
    }
}
export class SecurityError extends ERPError {
    constructor(message) {
        super('SECURITY_ERROR', message, 403);
    }
}
export class DuplicateInvoiceError extends BusinessError {
    constructor(invoiceNumber) {
        super('DUPLICATE_INVOICE_NUMBER', `Invoice number ${invoiceNumber} already exists for this tenant`, {
            invoiceNumber,
        });
    }
}
export class TenantSuspendedError extends ERPError {
    constructor(tenantId) {
        super('TENANT_SUSPENDED', `Tenant ${tenantId} is suspended`, 403, { tenantId });
    }
}
export class WorkflowApprovalRequiredError extends BusinessError {
    constructor(workflowType, entityId) {
        super('WORKFLOW_APPROVAL_REQUIRED', `Approval required for ${workflowType}`, {
            workflowType,
            entityId,
        });
    }
}
export class IdempotencyConflictError extends ERPError {
    constructor(idempotencyKey) {
        super('IDEMPOTENCY_CONFLICT', `Idempotency key already used: ${idempotencyKey}`, 409, {
            idempotencyKey,
        });
    }
}
//# sourceMappingURL=errors.js.map