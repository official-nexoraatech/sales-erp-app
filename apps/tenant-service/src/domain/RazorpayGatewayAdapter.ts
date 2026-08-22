/* global process */
import Razorpay from 'razorpay';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createLogger } from '@erp/logger';
import type { ChargeParams, ChargeResult, PaymentGatewayAdapter } from './PaymentGatewayAdapter.js';

const logger = createLogger({ serviceName: 'tenant-service' });

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

// PG-027 Session 2: verifies Razorpay's raw-HMAC webhook signature (X-Razorpay-Signature header,
// hex-encoded HMAC-SHA256 of the raw request body, keyed by the webhook secret configured in the
// Razorpay dashboard — not the API key/secret pair). Mirrors the pure-function, timing-safe-
// compare shape notification-service's webhookVerification.ts already uses for Meta/SendGrid,
// deliberately not imported cross-service (services don't import each other's src) but matching
// the same reviewed pattern rather than inventing a new one.
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  webhookSecret: string
): boolean {
  if (!webhookSecret || !signatureHeader) return false;
  const expected = createHmac('sha256', webhookSecret).update(rawBody, 'utf8').digest('hex');
  return safeEqual(signatureHeader, expected);
}

// customerRef for this adapter is a JSON-stringified payload carrying everything Razorpay's
// createRecurringPayment call requires beyond amount/currency: the saved Customer id, the
// specific saved-payment-method Token id, and the contact details Razorpay's API requires on
// every payment (email/contact) even for a token-based recurring charge. How this gets populated
// (a customer's card/UPI e-mandate onboarding flow) is out of scope for this session — see the
// gap-prompt's own Session 3 split.
interface RazorpayCustomerRef {
  customerId: string;
  tokenId: string;
  email: string;
  contact: string;
}

export class RazorpayGatewayAdapter implements PaymentGatewayAdapter {
  private readonly client: Razorpay;

  constructor(keyId: string, keySecret: string) {
    this.client = new Razorpay({ key_id: keyId, key_secret: keySecret });
  }

  async charge(params: ChargeParams): Promise<ChargeResult> {
    let ref: RazorpayCustomerRef;
    try {
      ref = JSON.parse(params.customerRef) as RazorpayCustomerRef;
    } catch {
      return { success: false, gatewayRef: '', failureReason: 'INVALID_CUSTOMER_REF' };
    }

    // order.id is created first and is stable regardless of whether the subsequent charge
    // attempt succeeds, fails synchronously, or is still pending an async webhook confirmation
    // (a common Razorpay case for UPI/netbanking) — it's returned as gatewayRef in every branch
    // below so BillingService can persist it on the invoice row, letting a later webhook for
    // that same order_id (billing-webhook.routes.ts) correlate back to this invoice even when
    // the synchronous call here reported failure or an indeterminate state.
    let orderId: string;
    try {
      const order = await this.client.orders.create({
        amount: params.amountPaise,
        currency: params.currency,
        receipt: `tenant-invoice-${params.tenantId}-${params.idempotencyKey}`,
        notes: { tenantId: String(params.tenantId) },
      });
      orderId = order.id;
    } catch (err) {
      logger.error({ tenantId: params.tenantId, err }, 'Razorpay order creation failed');
      return {
        success: false,
        gatewayRef: '',
        failureReason: err instanceof Error ? err.message : 'Order creation failed',
      };
    }

    try {
      // NOTE: not exercised against a real Razorpay account in this session (mocked per this
      // session's own scope decision — real credentials to be added later). Verify against a
      // real sandbox call once RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET are configured for real.
      const result = await this.client.payments.createRecurringPayment({
        amount: params.amountPaise,
        currency: params.currency,
        order_id: orderId,
        customer_id: ref.customerId,
        token: ref.tokenId,
        email: ref.email,
        contact: ref.contact,
        recurring: true,
        notes: { tenantId: String(params.tenantId), idempotencyKey: params.idempotencyKey },
      });

      if (result.razorpay_payment_id) {
        return { success: true, gatewayRef: orderId };
      }
      return { success: false, gatewayRef: orderId, failureReason: 'No payment id returned' };
    } catch (err) {
      logger.error({ tenantId: params.tenantId, err }, 'Razorpay charge failed');
      const failureReason =
        err instanceof Error
          ? ((err as { error?: { description?: string } }).error?.description ?? err.message)
          : 'Unknown gateway error';
      return { success: false, gatewayRef: orderId, failureReason };
    }
  }
}

// PG-027 Session 3: shared factory for both billing-internal.routes.ts (the daily job's target)
// and billing.routes.ts (the admin manual retry-payment route) — real credentials weren't
// configured by deliberate choice this session (see PG-027 Session 2's own "mock for now"
// decision); constructing the real adapter is deferred to first use, not bootstrap, so
// tenant-service can still start without RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET configured. When
// absent, charges fail with a clear, distinguishable reason instead of crashing the service.
export function createConfiguredGatewayAdapter(): PaymentGatewayAdapter {
  const keyId = process.env['RAZORPAY_KEY_ID'];
  const keySecret = process.env['RAZORPAY_KEY_SECRET'];
  if (!keyId || !keySecret) {
    return {
      charge: async () =>
        Promise.resolve({
          success: false,
          gatewayRef: '',
          failureReason: 'PAYMENT_GATEWAY_NOT_CONFIGURED',
        }),
    };
  }
  return new RazorpayGatewayAdapter(keyId, keySecret);
}
