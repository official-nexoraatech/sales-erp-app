import type { TenantScopedDatabase } from '@erp/sdk';
import { ptSlabs } from '@erp/db';
import { and, eq, gte, isNull, lte, or } from 'drizzle-orm';

export interface PTSlabRow {
  incomeUpto: number | null;
  monthlyAmount: number;
}

// branches.address.state / organizationSettings.address.state are free-text (see
// BranchesPage.tsx — plain Input, not the INDIAN_STATES dropdown used elsewhere), so a
// resolved state may be a full name ("Maharashtra") or a 2-letter code ("MH"). Normalize
// both to the code pt_slabs is keyed on; an unrecognized value falls through to no match,
// which getSlabsForState already resolves cleanly to 0 (never another state's rate).
const STATE_NAME_TO_CODE: Record<string, string> = {
  'ANDAMAN & NICOBAR ISLANDS': 'AN', 'ANDHRA PRADESH': 'AP', 'ARUNACHAL PRADESH': 'AR',
  ASSAM: 'AS', BIHAR: 'BR', CHANDIGARH: 'CH', CHHATTISGARH: 'CG',
  'DADRA & NAGAR HAVELI AND DAMAN & DIU': 'DN', DELHI: 'DL', GOA: 'GA', GUJARAT: 'GJ',
  HARYANA: 'HR', 'HIMACHAL PRADESH': 'HP', 'JAMMU & KASHMIR': 'JK', JHARKHAND: 'JH',
  KARNATAKA: 'KA', KERALA: 'KL', LADAKH: 'LA', LAKSHADWEEP: 'LD', 'MADHYA PRADESH': 'MP',
  MAHARASHTRA: 'MH', MANIPUR: 'MN', MEGHALAYA: 'ML', MIZORAM: 'MZ', NAGALAND: 'NL',
  ODISHA: 'OR', PUDUCHERRY: 'PY', PUNJAB: 'PB', RAJASTHAN: 'RJ', SIKKIM: 'SK',
  'TAMIL NADU': 'TN', TELANGANA: 'TS', TRIPURA: 'TR', 'UTTAR PRADESH': 'UP',
  UTTARAKHAND: 'UK', 'WEST BENGAL': 'WB',
};
const KNOWN_CODES = new Set(Object.values(STATE_NAME_TO_CODE));

export function normalizeStateToCode(state: string): string {
  const normalized = state.trim().toUpperCase();
  if (KNOWN_CODES.has(normalized)) return normalized;
  return STATE_NAME_TO_CODE[normalized] ?? normalized;
}

export class PTSlabService {
  // pt_slabs is global reference data (no tenant_id) — see migration 0045_pg044_pt_slabs.sql.
  static async getSlabsForState(
    db: TenantScopedDatabase,
    state: string,
    asOfDate: string
  ): Promise<PTSlabRow[]> {
    const stateCode = normalizeStateToCode(state);
    const rows = await db.raw
      .select({ slabOrder: ptSlabs.slabOrder, incomeUpto: ptSlabs.incomeUpto, monthlyAmount: ptSlabs.monthlyAmount })
      .from(ptSlabs)
      .where(and(
        eq(ptSlabs.stateCode, stateCode),
        lte(ptSlabs.effectiveFrom, asOfDate),
        or(isNull(ptSlabs.effectiveTo), gte(ptSlabs.effectiveTo, asOfDate)),
      ));

    return rows
      .sort((a, b) => a.slabOrder - b.slabOrder)
      .map((r) => ({
        incomeUpto: r.incomeUpto === null ? null : parseFloat(r.incomeUpto),
        monthlyAmount: parseFloat(r.monthlyAmount),
      }));
  }

  // Slab selection (by state + date) happens above; this applies an already-resolved slab
  // list — same loop shape as the old hardcoded PT_SLABS, just parameterized. Empty slabs
  // (state levies no PT) cleanly resolves to 0, not an error and not another state's rate.
  static computePT(grossMonthly: number, slabs: PTSlabRow[]): number {
    for (const slab of slabs) {
      if (slab.incomeUpto === null || grossMonthly <= slab.incomeUpto) {
        return slab.monthlyAmount;
      }
    }
    return 0;
  }
}
