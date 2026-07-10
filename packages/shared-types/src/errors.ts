export class ERPError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 500,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class ValidationError extends ERPError {
  constructor(message: string, field?: string) {
    super('VALIDATION_ERROR', message, 422, field !== undefined ? { field } : undefined);
  }
}

export class NotFoundError extends ERPError {
  constructor(entity: string, id?: number | string) {
    super('NOT_FOUND', `${entity} not found${id !== undefined ? ` (id: ${id})` : ''}`, 404);
  }
}

export class PermissionError extends ERPError {
  constructor(permission: string) {
    super('PERMISSION_DENIED', `Missing permission: ${permission}`, 403);
  }
}

export class BusinessError extends ERPError {
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(code, message, 422, details);
  }
}

export class InsufficientStockError extends BusinessError {
  constructor(itemId: number, requested: number, available: number) {
    super('INSUFFICIENT_STOCK', 'Insufficient stock for the requested quantity', {
      itemId,
      requested,
      available,
    });
  }
}

export class StockInsufficientForCostingError extends BusinessError {
  constructor(itemId: number, warehouseId: number, requested: number, availableInLayers: number) {
    super('STOCK_INSUFFICIENT', 'FIFO cost layers do not cover the requested quantity', {
      itemId,
      warehouseId,
      requested,
      availableInLayers,
    });
  }
}

export class CreditLimitExceededError extends BusinessError {
  constructor(customerId: number, creditLimit: number, newBalance: number) {
    super('CREDIT_LIMIT_EXCEEDED', 'Credit limit exceeded', {
      customerId,
      creditLimit,
      newBalance,
    });
  }
}

export class VendorCreditLimitExceededError extends BusinessError {
  constructor(supplierId: number, creditLimit: number, newBalance: number) {
    super('VENDOR_CREDIT_LIMIT_EXCEEDED', 'Purchase order would exceed vendor credit limit', {
      supplierId,
      creditLimit,
      newBalance,
    });
  }
}

export class OptimisticLockError extends ERPError {
  constructor(entity: string) {
    super(
      'OPTIMISTIC_LOCK_CONFLICT',
      `${entity} was modified by another user. Please refresh and retry.`,
      409
    );
  }
}

export class FinancialPeriodClosedError extends BusinessError {
  constructor(period: string) {
    super('FINANCIAL_PERIOD_CLOSED', `Financial period ${period} is closed`, { period });
  }
}

export class SecurityError extends ERPError {
  constructor(message: string) {
    super('SECURITY_ERROR', message, 403);
  }
}

export class DuplicateInvoiceError extends BusinessError {
  constructor(invoiceNumber: string) {
    super('DUPLICATE_INVOICE_NUMBER', `Invoice number ${invoiceNumber} already exists for this tenant`, {
      invoiceNumber,
    });
  }
}

export class TenantSuspendedError extends ERPError {
  constructor(tenantId: number) {
    super('TENANT_SUSPENDED', `Tenant ${tenantId} is suspended`, 403, { tenantId });
  }
}

export class TenantClosedError extends ERPError {
  constructor(tenantId: number) {
    super('TENANT_CLOSED', `Tenant ${tenantId} is closed`, 410, { tenantId });
  }
}

export class WorkflowApprovalRequiredError extends BusinessError {
  constructor(workflowType: string, entityId: number) {
    super('WORKFLOW_APPROVAL_REQUIRED', `Approval required for ${workflowType}`, {
      workflowType,
      entityId,
    });
  }
}

export class IdempotencyConflictError extends ERPError {
  constructor(idempotencyKey: string) {
    super('IDEMPOTENCY_CONFLICT', `Idempotency key already used: ${idempotencyKey}`, 409, {
      idempotencyKey,
    });
  }
}

export class ServiceUnavailableError extends ERPError {
  constructor(code: string, message: string) {
    super(code, message, 503);
  }
}
