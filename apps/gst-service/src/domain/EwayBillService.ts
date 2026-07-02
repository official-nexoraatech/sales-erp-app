import { eq, and, lte } from 'drizzle-orm';
import type { TenantScopedDatabase } from '@erp/sdk';
import { einvoiceData } from '@erp/db';
import { createLogger } from '@erp/logger';
import { BusinessError, NotFoundError } from '@erp/types';

const logger = createLogger({ serviceName: 'gst-service' });

const NIC_EWB_SANDBOX_URL = 'https://sandboxeinvoice.nic.in/ewaybillapi/v1.03';
const NIC_EWB_PROD_URL = process.env['NIC_EWB_URL'] ?? 'https://ewaybillgst.gov.in/apireg/api';

function getEwbBaseUrl(): string {
  return process.env['NODE_ENV'] === 'production' ? NIC_EWB_PROD_URL : NIC_EWB_SANDBOX_URL;
}

// e-Way Bill threshold: goods worth > ₹50,000
const EWB_VALUE_THRESHOLD = 50000;

export interface EwayBillPayload {
  supplyType: 'O' | 'I'; // Outward | Inward
  subSupplyType: string;
  docType: 'INV' | 'BIL' | 'BOE' | 'CNT' | 'CHL' | 'OTH';
  docNo: string;
  docDate: string; // DD/MM/YYYY
  fromGstin: string;
  fromTrdName: string;
  fromAddr1: string;
  fromAddr2?: string;
  fromPlace: string;
  fromPincode: number;
  fromStateCode: number;
  toGstin: string;
  toTrdName: string;
  toAddr1: string;
  toAddr2?: string;
  toPlace: string;
  toPincode: number;
  toStateCode: number;
  totalValue: number;
  cgstValue: number;
  sgstValue: number;
  igstValue: number;
  cessValue: number;
  transporterGstin?: string;
  transporterId?: string;
  transporterName?: string;
  transDocNo?: string;
  transMode: '1' | '2' | '3' | '4'; // Road, Rail, Air, Ship
  vehicleType?: 'R' | 'O'; // Regular | Over-Dimensional Cargo
  vehicleNo?: string;
  itemList: {
    productName: string;
    productDesc?: string;
    hsnCode: string;
    quantity: number;
    qtyUnit: string;
    cgstRate: number;
    sgstRate: number;
    igstRate: number;
    cessRate?: number;
    taxableAmount: number;
  }[];
}

export class EwayBillService {
  static async generate(
    db: TenantScopedDatabase,
    tenantId: number,
    invoiceId: number,
    payload: EwayBillPayload
  ): Promise<{ ewbNumber: string; ewbDate: string; validUpto: string }> {
    if (payload.totalValue <= EWB_VALUE_THRESHOLD) {
      throw new BusinessError('EWB_THRESHOLD_NOT_MET', `e-Way Bill not required for invoice value ≤ ₹${EWB_VALUE_THRESHOLD}`);
    }

    const apiKey = process.env['NIC_API_KEY'];
    if (!apiKey) {
      throw new BusinessError('NIC_NOT_CONFIGURED', 'NIC API key not configured');
    }

    const response = await fetch(`${getEwbBaseUrl()}/generateEWayBill`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'gstin': payload.fromGstin,
        'requestid': `ewb-${tenantId}-${invoiceId}-${Date.now()}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });

    const body = await response.json() as Record<string, unknown>;
    if (!response.ok) {
      throw new BusinessError('EWB_API_ERROR', `NIC e-Way Bill API error: ${String(body['message'] ?? response.statusText)}`);
    }

    const data = body['response'] as Record<string, unknown>;
    const ewbNumber = String(data?.['ewayBillNo'] ?? '');
    const ewbDate = String(data?.['ewayBillDate'] ?? '');
    const validUpto = String(data?.['validUpto'] ?? '');

    // Store in einvoice_data (co-located with IRN)
    const [existing] = await db.raw
      .select({ id: einvoiceData.id })
      .from(einvoiceData)
      .where(and(eq(einvoiceData.tenantId, tenantId), eq(einvoiceData.invoiceId, invoiceId)));

    if (existing) {
      await db.raw
        .update(einvoiceData)
        .set({
          ewbNumber,
          ewbDate: ewbDate ? new Date(ewbDate.replace(/(\d{2})\/(\d{2})\/(\d{4})/, '$3-$2-$1')) : new Date(),
          ewbValidUpto: validUpto ? new Date(validUpto.replace(/(\d{2})\/(\d{2})\/(\d{4})/, '$3-$2-$1')) : new Date(),
          updatedAt: new Date(),
        })
        .where(eq(einvoiceData.id, existing.id));
    }

    logger.info({ invoiceId, ewbNumber, validUpto }, 'e-Way Bill generated');
    return { ewbNumber, ewbDate, validUpto };
  }

  // Find e-Way Bills expiring in the next 24 hours (for alert job)
  static async getExpiringSoon(
    db: TenantScopedDatabase,
    tenantId: number
  ): Promise<{ invoiceId: number; invoiceNumber: string; ewbNumber: string; ewbValidUpto: Date }[]> {
    const tomorrow = new Date();
    tomorrow.setHours(tomorrow.getHours() + 24);

    const rows = await db.raw
      .select({
        invoiceId: einvoiceData.invoiceId,
        invoiceNumber: einvoiceData.invoiceNumber,
        ewbNumber: einvoiceData.ewbNumber,
        ewbValidUpto: einvoiceData.ewbValidUpto,
      })
      .from(einvoiceData)
      .where(
        and(
          eq(einvoiceData.tenantId, tenantId),
          lte(einvoiceData.ewbValidUpto, tomorrow)
        )
      );

    return rows
      .filter((r) => r.ewbNumber && r.ewbValidUpto)
      .map((r) => ({
        invoiceId: r.invoiceId,
        invoiceNumber: r.invoiceNumber,
        ewbNumber: r.ewbNumber ?? '',
        ewbValidUpto: r.ewbValidUpto as Date,
      }));
  }
}
