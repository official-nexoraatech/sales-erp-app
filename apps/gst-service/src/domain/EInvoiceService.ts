import { eq, and, lte, lt, sql } from 'drizzle-orm';
import type { TenantScopedDatabase } from '@erp/sdk';
import { type ErpDatabase } from '@erp/db';
import { einvoiceData } from '@erp/db';
import { createDatabaseClient } from '@erp/db';
import { createLogger } from '@erp/logger';
import { BusinessError, NotFoundError } from '@erp/types';

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

export class EInvoiceService {
  // Generate IRN for a given invoice — called manually or by event trigger
  static async generateIrn(
    db: TenantScopedDatabase,
    tenantId: number,
    userId: number,
    invoiceId: number,
    payload: NicEInvoicePayload
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
      const response = await fetch(`${getNicBaseUrl()}/IRP/generateIRN`, {
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

      await db.raw
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
    const response = await fetch(`${getNicBaseUrl()}/IRP/cancelIRN`, {
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
