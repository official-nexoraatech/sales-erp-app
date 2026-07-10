import { eq, and, lte, lt, sql } from 'drizzle-orm';
import type { TenantScopedDatabase } from '@erp/sdk';
import { PlatformEventBus } from '@erp/sdk';
import { type ErpDatabase } from '@erp/db';
import { einvoiceData, invoices, invoiceLines, items, units, organizationSettings, customers } from '@erp/db';
import { createDatabaseClient } from '@erp/db';
import { createLogger } from '@erp/logger';
import { BusinessError, NotFoundError } from '@erp/types';
import { ulid } from 'ulid';
import { fetchWithRetry } from './nicRetry.js';

const logger = createLogger({ serviceName: 'gst-service' });

// NIC IRP API endpoints — sandbox for dev, prod configurable
const NIC_SANDBOX_URL = 'https://einv-apisandbox.nic.in';
const NIC_PROD_URL = process.env['NIC_IRP_URL'] ?? 'https://einvoice1.gst.gov.in';
const MAX_RETRIES = 5;

function getNicBaseUrl(): string {
  return process.env['NODE_ENV'] === 'production' ? NIC_PROD_URL : NIC_SANDBOX_URL;
}

export interface NicEInvoicePayload {
  Version: string;
  TranDtls: {
    TaxSch: string;
    SupTyp: string;
    RegRev: string;
    EcmGstin?: string;
    IgstOnIntra?: string;
  };
  DocDtls: {
    Typ: string;
    No: string;
    Dt: string; // DD/MM/YYYY
  };
  SellerDtls: {
    Gstin: string;
    LglNm: string;
    TrdNm?: string;
    Addr1: string;
    Addr2?: string;
    Loc: string;
    Pin: number;
    Stcd: string;
    Ph?: string;
    Em?: string;
  };
  BuyerDtls: {
    Gstin: string;
    LglNm: string;
    TrdNm?: string;
    Pos: string;
    Addr1: string;
    Addr2?: string;
    Loc: string;
    Pin: number;
    Stcd: string;
    Ph?: string;
    Em?: string;
  };
  ItemList: {
    SlNo: string;
    PrdDesc: string;
    IsServc: string;
    HsnCd: string;
    Qty: number;
    Unit: string;
    UnitPrice: number;
    TotAmt: number;
    Discount?: number;
    PreTaxVal?: number;
    AssAmt: number;
    GstRt: number;
    IgstAmt: number;
    CgstAmt: number;
    SgstAmt: number;
    CesRt?: number;
    CesAmt?: number;
    TotItemVal: number;
  }[];
  ValDtls: {
    AssVal: number;
    CgstVal: number;
    SgstVal: number;
    IgstVal: number;
    CesVal: number;
    StCesVal?: number;
    Discount?: number;
    OthChrg?: number;
    RndOffAmt?: number;
    TotInvVal: number;
    TotInvValFc?: number;
  };
}

export interface NicIrnResponse {
  AckNo: string;
  AckDt: string; // YYYY-MM-DD HH:MM:SS
  Irn: string;
  SignedInvoice: string;
  SignedQRCode: string;
  Status: string;
}

export interface EInvoiceStatus {
  invoiceId: number;
  invoiceNumber: string;
  irnStatus: string;
  irn: string | null;
  ackNumber: string | null;
  ackDate: Date | null;
  signedQrCode: string | null;
  retryCount: number;
  failureReason: string | null;
  ewbNumber: string | null;
  ewbValidUpto: Date | null;
}

// ─── NIC payload builder (pure — invoice/line data in, NIC JSON out) ────────
// Note: this codebase stores money as DECIMAL rupees (not integer paise) throughout
// invoices/invoice_lines, so amounts are used as-is — no /100 conversion needed.
export interface BuildNicPayloadInput {
  invoiceNumber: string;
  invoiceDate: Date | string;
  seller: {
    gstin: string;
    legalName: string;
    address1: string;
    location: string;
    pincode: number;
    stateCode: string;
  };
  buyer: {
    gstin: string;
    legalName: string;
    placeOfSupply: string;
    address1: string;
    location: string;
    pincode: number;
    stateCode: string;
  };
  lines: {
    description: string;
    hsnCode: string;
    quantity: number;
    unit: string;
    unitPrice: number;
    taxableAmount: number;
    gstRate: number;
    cgstAmount: number;
    sgstAmount: number;
    igstAmount: number;
    cessRate: number;
    cessAmount: number;
    lineTotal: number;
    discountAmount: number;
  }[];
  taxableAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  cessAmount: number;
  grandTotal: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function toNicDate(d: Date | string): string {
  const dt = typeof d === 'string' ? new Date(d) : d;
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${dt.getUTCFullYear()}`;
}

export function buildNicPayload(input: BuildNicPayloadInput): NicEInvoicePayload {
  const isInterstate = input.igstAmount > 0;

  return {
    Version: '1.1',
    TranDtls: { TaxSch: 'GST', SupTyp: 'B2B', RegRev: 'N' },
    DocDtls: { Typ: 'INV', No: input.invoiceNumber, Dt: toNicDate(input.invoiceDate) },
    SellerDtls: {
      Gstin: input.seller.gstin,
      LglNm: input.seller.legalName,
      Addr1: input.seller.address1,
      Loc: input.seller.location,
      Pin: input.seller.pincode,
      Stcd: input.seller.stateCode,
    },
    BuyerDtls: {
      Gstin: input.buyer.gstin,
      LglNm: input.buyer.legalName,
      Pos: input.buyer.placeOfSupply,
      Addr1: input.buyer.address1,
      Loc: input.buyer.location,
      Pin: input.buyer.pincode,
      Stcd: input.buyer.stateCode,
    },
    ItemList: input.lines.map((line, idx) => ({
      SlNo: String(idx + 1),
      PrdDesc: line.description,
      IsServc: 'N',
      HsnCd: line.hsnCode,
      Qty: line.quantity,
      Unit: line.unit,
      UnitPrice: round2(line.unitPrice),
      TotAmt: round2(line.quantity * line.unitPrice),
      Discount: round2(line.discountAmount),
      AssAmt: round2(line.taxableAmount),
      GstRt: line.gstRate,
      IgstAmt: isInterstate ? round2(line.igstAmount) : 0,
      CgstAmt: isInterstate ? 0 : round2(line.cgstAmount),
      SgstAmt: isInterstate ? 0 : round2(line.sgstAmount),
      ...(line.cessRate ? { CesRt: line.cessRate } : {}),
      ...(line.cessAmount ? { CesAmt: round2(line.cessAmount) } : {}),
      TotItemVal: round2(line.lineTotal),
    })),
    ValDtls: {
      AssVal: round2(input.taxableAmount),
      CgstVal: isInterstate ? 0 : round2(input.cgstAmount),
      SgstVal: isInterstate ? 0 : round2(input.sgstAmount),
      IgstVal: isInterstate ? round2(input.igstAmount) : 0,
      CesVal: round2(input.cessAmount),
      TotInvVal: round2(input.grandTotal),
    },
  };
}

// Gathers invoice/lines/org/customer data and shapes it into BuildNicPayloadInput.
// Single source of truth for this — previously inlined separately inside
// EInvoiceEventConsumer.ts; now also used by GstComplianceSaga.ts so the saga's
// generate_irn step builds the identical payload the auto-IRN consumer would.
// Returns null (with a warn log for the two "misconfigured" cases) when e-Invoice
// doesn't apply or required data is missing — callers should skip silently.
export async function buildEinvoicePayloadInput(
  db: TenantScopedDatabase,
  tenantId: number,
  invoiceId: number,
  overrides?: { customerGstin?: string; customerName?: string; placeOfSupply?: string; invoiceNumber?: string }
): Promise<BuildNicPayloadInput | null> {
  const [invoice] = await db.raw
    .select()
    .from(invoices)
    .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, invoiceId)));
  if (!invoice) return null;

  const lineRows = await db.raw
    .select({
      description: invoiceLines.description,
      hsnCode: invoiceLines.hsnCode,
      quantity: invoiceLines.quantity,
      unitPrice: invoiceLines.unitPrice,
      taxableAmount: invoiceLines.taxableAmount,
      gstRate: invoiceLines.gstRate,
      cgstAmount: invoiceLines.cgstAmount,
      sgstAmount: invoiceLines.sgstAmount,
      igstAmount: invoiceLines.igstAmount,
      cessRate: invoiceLines.cessRate,
      cessAmount: invoiceLines.cessAmount,
      lineTotal: invoiceLines.lineTotal,
      discountAmount: invoiceLines.discountAmount,
      itemName: items.name,
      unitAbbr: units.abbreviation,
    })
    .from(invoiceLines)
    .leftJoin(items, eq(items.id, invoiceLines.itemId))
    .leftJoin(units, eq(units.id, invoiceLines.unitId))
    .where(and(eq(invoiceLines.tenantId, tenantId), eq(invoiceLines.invoiceId, invoiceId)));
  if (lineRows.length === 0) return null;

  const [org] = await db.raw
    .select()
    .from(organizationSettings)
    .where(eq(organizationSettings.tenantId, tenantId));
  if (!org?.gstin || !org.address) {
    logger.warn({ invoiceId }, 'e-Invoice: seller GSTIN/address not configured; skipping auto-IRN');
    return null;
  }

  const [customer] = await db.raw
    .select({
      gstin: customers.gstin,
      billingAddress: customers.billingAddress,
      displayName: customers.displayName,
      companyName: customers.companyName,
    })
    .from(customers)
    .where(and(eq(customers.tenantId, tenantId), eq(customers.id, invoice.customerId)));
  if (!customer?.billingAddress) {
    logger.warn({ invoiceId }, 'e-Invoice: buyer billing address not on file; skipping auto-IRN');
    return null;
  }

  const customerGstin = overrides?.customerGstin ?? customer.gstin;
  if (!customerGstin) return null; // B2C — e-Invoice not applicable

  return {
    invoiceNumber: invoice.invoiceNumber ?? overrides?.invoiceNumber ?? '',
    invoiceDate: invoice.invoiceDate,
    seller: {
      gstin: org.gstin,
      legalName: org.legalName ?? org.orgName,
      address1: org.address.line1,
      location: org.address.city,
      pincode: Number(org.address.pincode) || 0,
      stateCode: org.address.state,
    },
    buyer: {
      gstin: customerGstin,
      legalName: customer.companyName || customer.displayName || overrides?.customerName || 'Customer',
      placeOfSupply: overrides?.placeOfSupply ?? invoice.placeOfSupply,
      address1: customer.billingAddress.line1,
      location: customer.billingAddress.city,
      pincode: Number(customer.billingAddress.pincode) || 0,
      stateCode: customer.billingAddress.stateCode,
    },
    lines: lineRows.map((l) => ({
      description: l.description || l.itemName || 'Item',
      hsnCode: l.hsnCode ?? '0000',
      quantity: Number(l.quantity),
      unit: l.unitAbbr ?? 'NOS',
      unitPrice: Number(l.unitPrice),
      taxableAmount: Number(l.taxableAmount),
      gstRate: Number(l.gstRate),
      cgstAmount: Number(l.cgstAmount),
      sgstAmount: Number(l.sgstAmount),
      igstAmount: Number(l.igstAmount),
      cessRate: Number(l.cessRate),
      cessAmount: Number(l.cessAmount),
      lineTotal: Number(l.lineTotal),
      discountAmount: Number(l.discountAmount),
    })),
    taxableAmount: Number(invoice.taxableAmount),
    cgstAmount: Number(invoice.cgstAmount),
    sgstAmount: Number(invoice.sgstAmount),
    igstAmount: Number(invoice.igstAmount),
    cessAmount: Number(invoice.cessAmount),
    grandTotal: Number(invoice.grandTotal),
  };
}

export class EInvoiceService {
  // Generate IRN for a given invoice — called manually or by event trigger
  static async generateIrn(
    db: TenantScopedDatabase,
    tenantId: number,
    userId: number,
    invoiceId: number,
    payload: NicEInvoicePayload,
    correlationId?: string
  ): Promise<NicIrnResponse> {
    const apiKey = process.env['NIC_API_KEY'];
    if (!apiKey) {
      throw new BusinessError('NIC_NOT_CONFIGURED', 'NIC IRP API key not configured. Set NIC_API_KEY environment variable.');
    }

    // Check for existing IRN record
    const [existing] = await db.raw
      .select()
      .from(einvoiceData)
      .where(and(eq(einvoiceData.tenantId, tenantId), eq(einvoiceData.invoiceId, invoiceId)));

    if (existing?.irnStatus === 'IRN_GENERATED' && existing.irn) {
      logger.info({ invoiceId, irn: existing.irn }, 'e-Invoice: IRN already exists');
      return {
        AckNo: existing.ackNumber ?? '',
        AckDt: existing.ackDate?.toISOString() ?? '',
        Irn: existing.irn,
        SignedInvoice: existing.signedInvoice ?? '',
        SignedQRCode: existing.signedQrCode ?? '',
        Status: '1',
      };
    }

    // Create or update pending record
    const recordData = {
      tenantId,
      invoiceId,
      invoiceNumber: payload.DocDtls.No,
      irnStatus: 'PENDING_IRN' as const,
      nicRequestPayload: payload as unknown as Record<string, unknown>,
      createdBy: userId,
      updatedAt: new Date(),
    };

    if (!existing) {
      await db.raw.insert(einvoiceData).values(recordData);
    }

    try {
      const response = await fetchWithRetry(`${getNicBaseUrl()}/IRP/generateIRN`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'user_name': process.env['NIC_USERNAME'] ?? '',
          'password': process.env['NIC_PASSWORD'] ?? '',
          'gstin': payload.SellerDtls.Gstin,
          'requestid': `${tenantId}-${invoiceId}-${Date.now()}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      });

      const responseBody = await response.json() as Record<string, unknown>;

      if (!response.ok) {
        const errorCode = String(responseBody['ErrorCode'] ?? '');
        const errorMessage = String(responseBody['ErrorMessage'] ?? response.statusText);

        // NIC error 2150: duplicate invoice — fetch existing IRN
        if (errorCode === '2150') {
          logger.warn({ invoiceId, errorCode }, 'e-Invoice: duplicate IRN, fetching existing');
          return EInvoiceService.fetchExistingIrn(db, tenantId, invoiceId, payload, apiKey);
        }

        // NIC error 2271: invalid GSTIN — flag customer
        if (errorCode === '2271') {
          await EInvoiceService.markFailed(db, tenantId, invoiceId, `Invalid GSTIN: ${errorMessage}`, responseBody);
          throw new BusinessError('INVALID_GSTIN', `Buyer GSTIN invalid per NIC: ${payload.BuyerDtls.Gstin}`);
        }

        await EInvoiceService.markFailed(db, tenantId, invoiceId, errorMessage, responseBody);
        throw new BusinessError('NIC_API_ERROR', `NIC IRP returned error ${errorCode}: ${errorMessage}`);
      }

      const data = responseBody['data'] as Record<string, unknown>;
      const irn = String(data?.['Irn'] ?? '');
      const ackNumber = String(data?.['AckNo'] ?? '');
      const ackDt = String(data?.['AckDt'] ?? '');
      const signedQrCode = String(data?.['SignedQRCode'] ?? '');
      const signedInvoice = String(data?.['SignedInvoice'] ?? '');

      // ES-28 [M16-b]: the state-transition write and its outbox event must commit
      // atomically — publishing via a separate ctx.events.publish() call after this
      // returns reproduces the exact split-transaction bug C6 fixed elsewhere (a crash
      // between the two leaves the IRN recorded but no event ever published).
      await db.transaction(async (trx) => {
        await trx.raw
          .update(einvoiceData)
          .set({
            irn,
            ackNumber,
            ackDate: ackDt ? new Date(ackDt) : new Date(),
            signedQrCode,
            signedInvoice,
            irnStatus: 'IRN_GENERATED',
            retryCount: 0,
            failureReason: null,
            nicResponsePayload: responseBody,
            updatedAt: new Date(),
          })
          .where(and(eq(einvoiceData.tenantId, tenantId), eq(einvoiceData.invoiceId, invoiceId)));

        const eventBus = new PlatformEventBus(trx, tenantId, userId, correlationId ?? ulid());
        await eventBus.publishInTransaction('invoice', invoiceId, 'EINVOICE_GENERATED', {
          invoiceId,
          irn,
          ackNumber,
        });
      });

      logger.info({ invoiceId, irn, ackNumber }, 'e-Invoice: IRN generated successfully');

      return { AckNo: ackNumber, AckDt: ackDt, Irn: irn, SignedInvoice: signedInvoice, SignedQRCode: signedQrCode, Status: '1' };
    } catch (err) {
      if (err instanceof BusinessError) throw err;

      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err, invoiceId }, 'e-Invoice: NIC API call failed');

      // Network timeout — mark PENDING_IRN for retry
      await EInvoiceService.markPendingForRetry(db, tenantId, invoiceId, message);
      throw new BusinessError('IRN_PENDING', 'IRN generation queued for retry due to network timeout');
    }
  }

  // Cancel IRN at NIC portal
  static async cancelIrn(
    db: TenantScopedDatabase,
    tenantId: number,
    invoiceId: number,
    reason: string,
    remark?: string
  ): Promise<void> {
    const [record] = await db.raw
      .select()
      .from(einvoiceData)
      .where(and(eq(einvoiceData.tenantId, tenantId), eq(einvoiceData.invoiceId, invoiceId)));

    if (!record) throw new NotFoundError('e-Invoice record', invoiceId);
    if (record.irnStatus !== 'IRN_GENERATED' || !record.irn) {
      throw new BusinessError('IRN_NOT_CANCELLABLE', 'IRN must be in IRN_GENERATED status to cancel');
    }

    const apiKey = process.env['NIC_API_KEY'] ?? '';
    const response = await fetchWithRetry(`${getNicBaseUrl()}/IRP/cancelIRN`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ Irn: record.irn, CnlRsn: reason, CnlRem: remark ?? '' }),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const body = await response.json() as Record<string, unknown>;
      throw new BusinessError('NIC_CANCEL_ERROR', `NIC cancel failed: ${String(body['ErrorMessage'] ?? response.statusText)}`);
    }

    await db.raw
      .update(einvoiceData)
      .set({
        irnStatus: 'IRN_CANCELLED',
        cancelledAt: new Date(),
        cancelReason: reason,
        cancelRemark: remark ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(einvoiceData.tenantId, tenantId), eq(einvoiceData.invoiceId, invoiceId)));

    logger.info({ invoiceId, irn: record.irn }, 'e-Invoice: IRN cancelled at NIC');
  }

  // Get IRN status
  static async getStatus(
    db: TenantScopedDatabase,
    tenantId: number,
    invoiceId: number
  ): Promise<EInvoiceStatus> {
    const [record] = await db.raw
      .select()
      .from(einvoiceData)
      .where(and(eq(einvoiceData.tenantId, tenantId), eq(einvoiceData.invoiceId, invoiceId)));

    if (!record) {
      return {
        invoiceId,
        invoiceNumber: '',
        irnStatus: 'NOT_APPLICABLE',
        irn: null,
        ackNumber: null,
        ackDate: null,
        signedQrCode: null,
        retryCount: 0,
        failureReason: null,
        ewbNumber: null,
        ewbValidUpto: null,
      };
    }

    return {
      invoiceId: record.invoiceId,
      invoiceNumber: record.invoiceNumber,
      irnStatus: record.irnStatus,
      irn: record.irn,
      ackNumber: record.ackNumber,
      ackDate: record.ackDate,
      signedQrCode: record.signedQrCode,
      retryCount: record.retryCount,
      failureReason: record.failureReason,
      ewbNumber: record.ewbNumber,
      ewbValidUpto: record.ewbValidUpto,
    };
  }

  // Manual single-invoice retry — re-uses the NIC payload stored on the original attempt.
  // Used by the "Retry" button on EInvoicePage for FAILED_IRN/PENDING_IRN invoices.
  static async retrySingle(
    db: TenantScopedDatabase,
    tenantId: number,
    userId: number,
    invoiceId: number
  ): Promise<NicIrnResponse> {
    const [record] = await db.raw
      .select()
      .from(einvoiceData)
      .where(and(eq(einvoiceData.tenantId, tenantId), eq(einvoiceData.invoiceId, invoiceId)));

    if (!record) throw new NotFoundError('e-Invoice record', invoiceId);
    if (!record.nicRequestPayload) {
      throw new BusinessError('NO_STORED_PAYLOAD', 'No stored NIC payload to retry — generate the IRN again from the invoice');
    }

    return EInvoiceService.generateIrn(
      db,
      tenantId,
      userId,
      invoiceId,
      record.nicRequestPayload as unknown as NicEInvoicePayload
    );
  }

  // Retry all PENDING_IRN invoices across all tenants (called by scheduler every 15 min)
  static async retryPendingIrns(): Promise<{ retried: number; failed: number }> {
    const databaseUrl = process.env['DATABASE_URL'];
    if (!databaseUrl) {
      logger.error({}, 'retryPendingIrns: DATABASE_URL not set');
      return { retried: 0, failed: 0 };
    }
    const rawDb: ErpDatabase = createDatabaseClient({ url: databaseUrl, maxConnections: 2 });

    const pending = await rawDb
      .select()
      .from(einvoiceData)
      .where(
        and(
          eq(einvoiceData.irnStatus, 'PENDING_IRN'),
          lt(einvoiceData.retryCount, MAX_RETRIES)
        )
      );

    let retried = 0;
    let failed = 0;

    for (const record of pending) {
      if (!record.nicRequestPayload) continue;
      // Build a minimal TenantScopedDatabase wrapper for the per-record call
      const tenantId = record.tenantId;
      const tenantDb = { raw: rawDb, tenantId } as unknown as TenantScopedDatabase;
      try {
        await EInvoiceService.generateIrn(
          tenantDb,
          tenantId,
          record.createdBy,
          record.invoiceId,
          record.nicRequestPayload as unknown as NicEInvoicePayload
        );
        retried++;
      } catch {
        failed++;
        if (record.retryCount + 1 >= MAX_RETRIES) {
          await rawDb
            .update(einvoiceData)
            .set({ irnStatus: 'FAILED_IRN', updatedAt: new Date() })
            .where(eq(einvoiceData.id, record.id));
          logger.error({ invoiceId: record.invoiceId }, 'e-Invoice: moved to FAILED_IRN after max retries');
        }
      }
    }

    return { retried, failed };
  }

  private static async fetchExistingIrn(
    db: TenantScopedDatabase,
    tenantId: number,
    invoiceId: number,
    payload: NicEInvoicePayload,
    apiKey: string
  ): Promise<NicIrnResponse> {
    const response = await fetch(
      `${getNicBaseUrl()}/IRP/getIRNDetails/${payload.DocDtls.No}?gstin=${payload.SellerDtls.Gstin}`,
      { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10000) }
    );

    if (!response.ok) throw new BusinessError('NIC_FETCH_ERROR', 'Failed to fetch existing IRN from NIC');

    const body = await response.json() as Record<string, unknown>;
    const data = body['data'] as Record<string, unknown>;
    const irn = String(data?.['Irn'] ?? '');
    const ackNumber = String(data?.['AckNo'] ?? '');
    const ackDt = String(data?.['AckDt'] ?? '');
    const signedQrCode = String(data?.['SignedQRCode'] ?? '');
    const signedInvoice = String(data?.['SignedInvoice'] ?? '');

    await db.raw
      .update(einvoiceData)
      .set({ irn, ackNumber, ackDate: new Date(), signedQrCode, signedInvoice, irnStatus: 'IRN_GENERATED', updatedAt: new Date() })
      .where(and(eq(einvoiceData.tenantId, tenantId), eq(einvoiceData.invoiceId, invoiceId)));

    return { AckNo: ackNumber, AckDt: ackDt, Irn: irn, SignedInvoice: signedInvoice, SignedQRCode: signedQrCode, Status: '1' };
  }

  private static async markFailed(
    db: TenantScopedDatabase,
    tenantId: number,
    invoiceId: number,
    reason: string,
    responseBody: Record<string, unknown>
  ): Promise<void> {
    await db.raw
      .update(einvoiceData)
      .set({ irnStatus: 'FAILED_IRN', failureReason: reason, nicResponsePayload: responseBody, updatedAt: new Date() })
      .where(and(eq(einvoiceData.tenantId, tenantId), eq(einvoiceData.invoiceId, invoiceId)));
  }

  private static async markPendingForRetry(
    db: TenantScopedDatabase,
    tenantId: number,
    invoiceId: number,
    reason: string
  ): Promise<void> {
    await db.raw
      .update(einvoiceData)
      .set({
        irnStatus: 'PENDING_IRN',
        failureReason: reason,
        retryCount: sql`retry_count + 1`,
        lastRetryAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(einvoiceData.tenantId, tenantId), eq(einvoiceData.invoiceId, invoiceId)));
  }
}
