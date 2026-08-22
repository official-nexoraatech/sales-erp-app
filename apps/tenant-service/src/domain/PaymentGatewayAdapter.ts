// PG-027 Session 2: provider-agnostic payment gateway boundary. No prior art exists elsewhere in
// this codebase for external payment integration — this interface exists so the concrete gateway
// (Razorpay, chosen 2026-08-20) is a swappable implementation behind one interface, never
// scattered through route handlers or BillingService directly.
export interface ChargeParams {
  tenantId: number;
  amountPaise: number;
  currency: string;
  customerRef: string;
  idempotencyKey: string;
}

export interface ChargeResult {
  success: boolean;
  gatewayRef: string;
  failureReason?: string;
}

export interface PaymentGatewayAdapter {
  charge(params: ChargeParams): Promise<ChargeResult>;
}
