import { eq, and, sql } from 'drizzle-orm';
import type { TenantScopedDatabase } from '@erp/sdk';
import { gstLedger } from '@erp/db';
import { createLogger } from '@erp/logger';

const logger = createLogger({ serviceName: 'gst-service' });

// B2B threshold: ≥ ₹2.5 lakh for B2CS / B2CL split
const B2CS_THRESHOLD = 250000;

export interface Gstr1B2BEntry {
  gstin: string;
  receiverName: string;
  invoiceNumber: string;
  invoiceDate: string;
  invoiceValue: number;
  placeOfSupply: string;
  reverseCharge: boolean;
  invoiceType: string;
  eCommerceGstin: string;
  rate: number;
  taxableValue: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  cessAmount: number;
}

export interface Gstr1B2CSEntry {
  type: string;
  placeOfSupply: string;
  applicablePercentage: number;
  rate: number;
  taxableValue: number;
  cgstAmount: number;
  sgstAmount: number;
  eCommerceGstin: string;
}

export interface Gstr1HsnEntry {
  num: number;
  hsnSac: string;
  description: string;
  uqc: string;
  totalQuantity: number;
  totalValue: number;
  taxableValue: number;
  rate: number;
  igstAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  cessAmount: number;
}

export interface Gstr1Section {
  b2b: Gstr1B2BEntry[];
  b2cs: Gstr1B2CSEntry[];
  b2cl: { pos: string; inv: Gstr1B2BEntry[] }[];
  cdnr: Gstr1B2BEntry[];
  cdnur: Gstr1B2BEntry[];
  exp: Gstr1B2BEntry[];
  hsn: { data: Gstr1HsnEntry[] };
  doc: { docDet: { docNum: number; from: string; to: string; totnum: number; cancel: number; net: number }[] }[];
}

export class Gstr1Service {
  static async compute(
    db: TenantScopedDatabase,
    tenantId: number,
    period: string
  ): Promise<Gstr1Section> {
    logger.info({ tenantId, period }, 'Computing GSTR-1');

    const salesEntries = await db.raw
      .select()
      .from(gstLedger)
      .where(
        and(
          eq(gstLedger.tenantId, tenantId),
          eq(gstLedger.periodMonth, period),
          eq(gstLedger.entryType, 'SALES_INVOICE')
        )
      )
      .orderBy(gstLedger.documentDate);

    const creditNoteEntries = await db.raw
      .select()
      .from(gstLedger)
      .where(
        and(
          eq(gstLedger.tenantId, tenantId),
          eq(gstLedger.periodMonth, period),
          eq(gstLedger.entryType, 'CREDIT_NOTE')
        )
      );

    const n = (v: unknown): number => Number(v ?? 0);

    // ── B2B: registered customers with GSTIN ──────────────────────────────────
    const b2bEntries: Gstr1B2BEntry[] = salesEntries
      .filter((e) => e.gstinOfCounterparty && e.gstinOfCounterparty.length === 15)
      .map((e) => ({
        gstin: e.gstinOfCounterparty ?? '',
        receiverName: e.counterpartyName ?? '',
        invoiceNumber: e.documentNumber,
        invoiceDate: String(e.documentDate),
        invoiceValue: n(e.grandTotal),
        placeOfSupply: e.placeOfSupply ?? '',
        reverseCharge: e.rcmApplicable,
        invoiceType: 'Regular',
        eCommerceGstin: '',
        rate: n(e.gstRate),
        taxableValue: n(e.taxableAmount),
        cgstAmount: n(e.cgstAmount),
        sgstAmount: n(e.sgstAmount),
        igstAmount: n(e.igstAmount),
        cessAmount: n(e.cessAmount),
      }));

    // ── B2C: unregistered customers (no GSTIN) ────────────────────────────────
    const b2cEntries = salesEntries.filter(
      (e) => !e.gstinOfCounterparty || e.gstinOfCounterparty.length !== 15
    );

    // B2CS: > ₹2.5 lakh — group by state + rate
    const b2csMap = new Map<string, Gstr1B2CSEntry>();
    // B2CL: ≤ ₹2.5 lakh — per invoice (intrastate only in practice, but standard is per invoice)
    const b2clEntries: Gstr1B2BEntry[] = [];

    for (const e of b2cEntries) {
      const val = n(e.grandTotal);
      const key = `${e.placeOfSupply}|${n(e.gstRate)}`;
      if (val > B2CS_THRESHOLD) {
        const existing = b2csMap.get(key);
        if (existing) {
          existing.taxableValue += n(e.taxableAmount);
          existing.cgstAmount += n(e.cgstAmount);
          existing.sgstAmount += n(e.sgstAmount);
        } else {
          b2csMap.set(key, {
            type: e.isInterstate ? 'INTER' : 'INTRA',
            placeOfSupply: e.placeOfSupply ?? '',
            applicablePercentage: 0,
            rate: n(e.gstRate),
            taxableValue: n(e.taxableAmount),
            cgstAmount: n(e.cgstAmount),
            sgstAmount: n(e.sgstAmount),
            eCommerceGstin: '',
          });
        }
      } else {
        b2clEntries.push({
          gstin: '',
          receiverName: e.counterpartyName ?? '',
          invoiceNumber: e.documentNumber,
          invoiceDate: String(e.documentDate),
          invoiceValue: val,
          placeOfSupply: e.placeOfSupply ?? '',
          reverseCharge: e.rcmApplicable,
          invoiceType: 'Regular',
          eCommerceGstin: '',
          rate: n(e.gstRate),
          taxableValue: n(e.taxableAmount),
          cgstAmount: n(e.cgstAmount),
          sgstAmount: n(e.sgstAmount),
          igstAmount: n(e.igstAmount),
          cessAmount: n(e.cessAmount),
        });
      }
    }

    // Group B2CL by state
    const b2clByState = new Map<string, Gstr1B2BEntry[]>();
    for (const inv of b2clEntries) {
      const state = inv.placeOfSupply;
      const list = b2clByState.get(state) ?? [];
      list.push(inv);
      b2clByState.set(state, list);
    }

    // ── CDNR / CDNUR: credit notes ─────────────────────────────────────────────
    const cdnr: Gstr1B2BEntry[] = creditNoteEntries
      .filter((e) => e.gstinOfCounterparty && e.gstinOfCounterparty.length === 15)
      .map((e) => ({
        gstin: e.gstinOfCounterparty ?? '',
        receiverName: e.counterpartyName ?? '',
        invoiceNumber: e.documentNumber,
        invoiceDate: String(e.documentDate),
        invoiceValue: n(e.grandTotal),
        placeOfSupply: e.placeOfSupply ?? '',
        reverseCharge: e.rcmApplicable,
        invoiceType: 'Credit Note',
        eCommerceGstin: '',
        rate: n(e.gstRate),
        taxableValue: n(e.taxableAmount),
        cgstAmount: n(e.cgstAmount),
        sgstAmount: n(e.sgstAmount),
        igstAmount: n(e.igstAmount),
        cessAmount: n(e.cessAmount),
      }));

    const cdnur: Gstr1B2BEntry[] = creditNoteEntries
      .filter((e) => !e.gstinOfCounterparty || e.gstinOfCounterparty.length !== 15)
      .map((e) => ({
        gstin: '',
        receiverName: e.counterpartyName ?? '',
        invoiceNumber: e.documentNumber,
        invoiceDate: String(e.documentDate),
        invoiceValue: n(e.grandTotal),
        placeOfSupply: e.placeOfSupply ?? '',
        reverseCharge: false,
        invoiceType: 'Credit Note',
        eCommerceGstin: '',
        rate: n(e.gstRate),
        taxableValue: n(e.taxableAmount),
        cgstAmount: n(e.cgstAmount),
        sgstAmount: n(e.sgstAmount),
        igstAmount: n(e.igstAmount),
        cessAmount: n(e.cessAmount),
      }));

    // ── EXP: exports (place_of_supply = "96" per GSTN convention) ─────────────
    const exp: Gstr1B2BEntry[] = salesEntries
      .filter((e) => e.placeOfSupply === '96')
      .map((e) => ({
        gstin: '',
        receiverName: e.counterpartyName ?? '',
        invoiceNumber: e.documentNumber,
        invoiceDate: String(e.documentDate),
        invoiceValue: n(e.grandTotal),
        placeOfSupply: '96',
        reverseCharge: false,
        invoiceType: 'Export with IGST',
        eCommerceGstin: '',
        rate: n(e.gstRate),
        taxableValue: n(e.taxableAmount),
        cgstAmount: 0,
        sgstAmount: 0,
        igstAmount: n(e.igstAmount),
        cessAmount: 0,
      }));

    // ── HSN Summary ────────────────────────────────────────────────────────────
    const hsnMap = new Map<string, Gstr1HsnEntry>();
    let hsnNum = 1;
    for (const e of [...salesEntries, ...creditNoteEntries]) {
      if (!e.hsnCode) continue;
      const key = `${e.hsnCode}|${n(e.gstRate)}`;
      const existing = hsnMap.get(key);
      const isReturn = e.entryType === 'CREDIT_NOTE';
      const sign = isReturn ? -1 : 1;
      if (existing) {
        existing.taxableValue += sign * n(e.taxableAmount);
        existing.totalValue += sign * n(e.grandTotal);
        existing.igstAmount += sign * n(e.igstAmount);
        existing.cgstAmount += sign * n(e.cgstAmount);
        existing.sgstAmount += sign * n(e.sgstAmount);
        existing.cessAmount += sign * n(e.cessAmount);
      } else {
        hsnMap.set(key, {
          num: hsnNum++,
          hsnSac: e.hsnCode,
          description: '',
          uqc: 'NOS',
          totalQuantity: 0,
          totalValue: sign * n(e.grandTotal),
          taxableValue: sign * n(e.taxableAmount),
          rate: n(e.gstRate),
          igstAmount: sign * n(e.igstAmount),
          cgstAmount: sign * n(e.cgstAmount),
          sgstAmount: sign * n(e.sgstAmount),
          cessAmount: sign * n(e.cessAmount),
        });
      }
    }

    // ── DOC Summary ────────────────────────────────────────────────────────────
    // TODO: When number series is wired, extract from/to invoice numbers
    const doc = [
      {
        docDet: [
          {
            docNum: 1,
            from: 'INV-001',
            to: `INV-${String(salesEntries.length).padStart(3, '0')}`,
            totnum: salesEntries.length,
            cancel: 0,
            net: salesEntries.length,
          },
        ],
      },
    ];

    return {
      b2b: b2bEntries,
      b2cs: Array.from(b2csMap.values()),
      b2cl: Array.from(b2clByState.entries()).map(([pos, inv]) => ({ pos, inv })),
      cdnr,
      cdnur,
      exp,
      hsn: { data: Array.from(hsnMap.values()) },
      doc,
    };
  }

  // Build NIC-compatible JSON export for GSTR-1
  static toNicJson(
    gstin: string,
    period: string, // MMYYYY
    section: Gstr1Section
  ): Record<string, unknown> {
    return {
      gstin,
      fp: period,
      gt: section.b2b.reduce((s, e) => s + e.invoiceValue, 0) +
           section.b2cs.reduce((s, e) => s + e.taxableValue, 0),
      cur_gt: 0,
      b2b: Gstr1Service.groupB2bByGstin(section.b2b),
      b2cs: section.b2cs,
      b2cl: section.b2cl,
      cdnr: Gstr1Service.groupB2bByGstin(section.cdnr),
      cdnur: section.cdnur,
      exp: section.exp,
      hsn: section.hsn,
      doc: section.doc,
    };
  }

  private static groupB2bByGstin(entries: Gstr1B2BEntry[]): unknown[] {
    const map = new Map<string, { ctin: string; inv: unknown[] }>();
    for (const e of entries) {
      const group = map.get(e.gstin) ?? { ctin: e.gstin, inv: [] };
      group.inv.push({
        inum: e.invoiceNumber,
        idt: e.invoiceDate,
        val: e.invoiceValue,
        pos: e.placeOfSupply,
        rchrg: e.reverseCharge ? 'Y' : 'N',
        inv_typ: e.invoiceType,
        itms: [
          {
            num: 1,
            itm_det: {
              rt: e.rate,
              txval: e.taxableValue,
              camt: e.cgstAmount,
              samt: e.sgstAmount,
              iamt: e.igstAmount,
              csamt: e.cessAmount,
            },
          },
        ],
      });
      map.set(e.gstin, group);
    }
    return Array.from(map.values());
  }

  // Build validation errors before export
  static validateBeforeExport(section: Gstr1Section): string[] {
    const errors: string[] = [];
    const gstinRegex = /^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}$/;
    for (const entry of section.b2b) {
      if (!gstinRegex.test(entry.gstin)) {
        errors.push(`Invalid GSTIN on invoice ${entry.invoiceNumber}: ${entry.gstin}`);
      }
    }
    const allInvNumbers = [...section.b2b, ...section.b2cl.flatMap((s) => s.inv)].map((e) => e.invoiceNumber);
    const unique = new Set(allInvNumbers);
    if (unique.size !== allInvNumbers.length) {
      errors.push('Duplicate invoice numbers detected in GSTR-1');
    }
    return errors;
  }
}
