/**
 * Tally ERP XML Parser
 *
 * Tally exports data via XML (via ODBC or built-in export).
 * Format: Tally XML Collection format used by TallyPrime 2.x / 3.x.
 *
 * To export from Tally:
 *   Gateway of Tally → Display → Account Books → Ledger → Export (XML)
 *   Gateway of Tally → Inventory Info → Stock Items → Export (XML)
 *
 * install fast-xml-parser:
 *   pnpm add fast-xml-parser
 */

import { XMLParser } from 'fast-xml-parser';
import fs from 'node:fs';
import path from 'node:path';
import type { CanonicalCustomer, CanonicalSupplier, CanonicalItem } from '../../types.js';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) => ['LEDGER', 'STOCKITEM', 'ADDRESS'].includes(name),
  parseTagValue: true,
  trimValues: true,
});

function readXml(filePath: string): unknown {
  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`File not found: ${absPath}`);
  }
  const xml = fs.readFileSync(absPath, 'utf8');
  return parser.parse(xml);
}

function str(val: unknown): string {
  return String(val ?? '').trim();
}

function num(val: unknown): number {
  const s = String(val ?? '0').replace(/,/g, '').replace('Dr', '').replace('Cr', '').trim();
  const n = parseFloat(s);
  return isNaN(n) ? 0 : Math.abs(n);
}

// ── Customer Parser ───────────────────────────────────────────────────────────

export function parseTallyCustomers(filePath: string): CanonicalCustomer[] {
  const xml = readXml(filePath) as Record<string, unknown>;
  const envelope = (xml['ENVELOPE'] ?? {}) as Record<string, unknown>;
  const body = (envelope['BODY'] ?? {}) as Record<string, unknown>;
  const importData = (body['IMPORTDATA'] ?? body['EXPORTDATA'] ?? {}) as Record<string, unknown>;
  const requestData = (importData['REQUESTDATA'] ?? importData['TALLYMESSAGE'] ?? {}) as Record<string, unknown>;

  // Tally XML nests: ENVELOPE > BODY > IMPORTDATA > REQUESTDATA > TALLYMESSAGE > LEDGER[]
  const messages = Array.isArray(requestData) ? requestData : [requestData];
  const ledgers: unknown[] = [];

  for (const msg of messages) {
    const msgObj = msg as Record<string, unknown>;
    const l = msgObj['LEDGER'];
    if (Array.isArray(l)) ledgers.push(...l);
    else if (l) ledgers.push(l);
  }

  return ledgers.map((led) => {
    const l = led as Record<string, unknown>;
    const addresses = Array.isArray(l['ADDRESS']) ? (l['ADDRESS'] as string[]) : [];
    return {
      displayName: str(l['NAME'] ?? l['@_NAME']),
      gstin: str(l['GSTREGISTRATIONNUMBER'] ?? l['GSTIN'] ?? ''),
      pan: str(l['INCOMETAXNUMBER'] ?? l['PAN'] ?? ''),
      phone: str(l['LEDGERMOBILE'] ?? l['BANKINGRPHNUMBER'] ?? ''),
      email: str(l['EMAIL'] ?? ''),
      address: addresses.slice(0, 2).join(', '),
      city: addresses[2] ? str(addresses[2]) : undefined,
      state: str(l['COUNTRYNAME'] ?? l['STATENAME'] ?? ''),
      pincode: str(l['PINCODE'] ?? ''),
      openingBalance: num(l['OPENINGBALANCE']),
      creditLimit: num(l['CREDITLIMIT'] ?? '0'),
    };
  });
}

// ── Supplier Parser ───────────────────────────────────────────────────────────

export function parseTallySuppliers(filePath: string): CanonicalSupplier[] {
  // Tally does not distinguish customers from suppliers in ledger export.
  // Supplier ledgers belong to group: Sundry Creditors.
  // This parser filters by group.
  const xml = readXml(filePath) as Record<string, unknown>;
  const envelope = (xml['ENVELOPE'] ?? {}) as Record<string, unknown>;
  const body = (envelope['BODY'] ?? {}) as Record<string, unknown>;
  const importData = (body['IMPORTDATA'] ?? body['EXPORTDATA'] ?? {}) as Record<string, unknown>;
  const requestData = (importData['REQUESTDATA'] ?? importData['TALLYMESSAGE'] ?? {}) as Record<string, unknown>;

  const messages = Array.isArray(requestData) ? requestData : [requestData];
  const ledgers: unknown[] = [];

  for (const msg of messages) {
    const msgObj = msg as Record<string, unknown>;
    const l = msgObj['LEDGER'];
    if (Array.isArray(l)) ledgers.push(...l);
    else if (l) ledgers.push(l);
  }

  return ledgers
    .filter((led) => {
      const l = led as Record<string, unknown>;
      const parent = str(l['PARENT'] ?? '').toLowerCase();
      return parent.includes('creditor') || parent.includes('supplier');
    })
    .map((led) => {
      const l = led as Record<string, unknown>;
      const addresses = Array.isArray(l['ADDRESS']) ? (l['ADDRESS'] as string[]) : [];
      return {
        displayName: str(l['NAME'] ?? l['@_NAME']),
        gstin: str(l['GSTREGISTRATIONNUMBER'] ?? ''),
        phone: str(l['LEDGERMOBILE'] ?? ''),
        email: str(l['EMAIL'] ?? ''),
        address: addresses.slice(0, 2).join(', '),
        city: addresses[2] ? str(addresses[2]) : undefined,
        state: str(l['STATENAME'] ?? ''),
        pincode: str(l['PINCODE'] ?? ''),
        openingBalance: num(l['OPENINGBALANCE']),
      };
    });
}

// ── Stock Item Parser ─────────────────────────────────────────────────────────

export function parseTallyItems(filePath: string): CanonicalItem[] {
  const xml = readXml(filePath) as Record<string, unknown>;
  const envelope = (xml['ENVELOPE'] ?? {}) as Record<string, unknown>;
  const body = (envelope['BODY'] ?? {}) as Record<string, unknown>;
  const importData = (body['IMPORTDATA'] ?? body['EXPORTDATA'] ?? {}) as Record<string, unknown>;
  const requestData = (importData['REQUESTDATA'] ?? importData['TALLYMESSAGE'] ?? {}) as Record<string, unknown>;

  const messages = Array.isArray(requestData) ? requestData : [requestData];
  const items: unknown[] = [];

  for (const msg of messages) {
    const msgObj = msg as Record<string, unknown>;
    const i = msgObj['STOCKITEM'];
    if (Array.isArray(i)) items.push(...i);
    else if (i) items.push(i);
  }

  return items.map((it) => {
    const item = it as Record<string, unknown>;
    return {
      name: str(item['NAME'] ?? item['@_NAME']),
      hsnCode: str(item['HSNDETAILS']?.toString() ?? item['HSNCODE'] ?? item['HSNSACCODE'] ?? '0000'),
      gstRate: num(item['GSTRATE'] ?? item['IGSTRATE'] ?? '0'),
      unit: str(item['BASEUNITS'] ?? item['UNITS'] ?? 'Pieces'),
      category: str(item['PARENT'] ?? ''),
      sellingPrice: num(item['LASTPURCHASECOST'] ?? item['STANDARDCOST'] ?? '0'),
      costPrice: num(item['LASTPURCHASECOST'] ?? '0'),
    };
  });
}
