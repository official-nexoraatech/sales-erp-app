import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { Gstr1ExcelFormatter } from '../domain/Gstr1ExcelFormatter.js';
import type { Gstr1Section } from '../domain/Gstr1Service.js';

function makeSections(): Gstr1Section {
  return {
    b2b: [
      {
        gstin: '27AAAAA0000A1Z5', receiverName: 'Acme Co', invoiceNumber: 'INV-001',
        invoiceDate: '2025-06-01', invoiceValue: 11800, placeOfSupply: '27',
        reverseCharge: false, invoiceType: 'Regular', eCommerceGstin: '', rate: 18,
        taxableValue: 10000, cgstAmount: 900, sgstAmount: 900, igstAmount: 0, cessAmount: 0,
      },
    ],
    b2cs: [
      {
        type: 'INTRA', placeOfSupply: '27', applicablePercentage: 0, rate: 18,
        taxableValue: 300000, cgstAmount: 27000, sgstAmount: 27000, eCommerceGstin: '',
      },
    ],
    b2cl: [],
    cdnr: [
      {
        gstin: '27AAAAA0000A1Z5', receiverName: 'Acme Co', invoiceNumber: 'CN-001',
        invoiceDate: '2025-06-05', invoiceValue: 1180, placeOfSupply: '27',
        reverseCharge: false, invoiceType: 'Credit Note', eCommerceGstin: '', rate: 18,
        taxableValue: 1000, cgstAmount: 90, sgstAmount: 90, igstAmount: 0, cessAmount: 0,
      },
    ],
    cdnur: [],
    exp: [],
    hsn: {
      data: [
        {
          num: 1, hsnSac: '8471', description: '', uqc: 'NOS', totalQuantity: 0,
          totalValue: 11800, taxableValue: 10000, rate: 18, igstAmount: 0,
          cgstAmount: 900, sgstAmount: 900, cessAmount: 0,
        },
      ],
    },
    doc: [
      {
        docDet: [
          { docNum: 1, from: 'INV-001', to: 'INV-001', totnum: 1, cancel: 0, net: 1 },
        ],
      },
    ],
  };
}

describe('Gstr1ExcelFormatter.toWorkbook', () => {
  it('returns a Buffer starting with the xlsx (ZIP) magic number', () => {
    const buf = Gstr1ExcelFormatter.toWorkbook(makeSections());
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.subarray(0, 2).toString('ascii')).toBe('PK');
  });

  it('produces 5 sheets named B2B, B2CS, CDNR, HSN, DOC with matching row counts', () => {
    const sections = makeSections();
    const buf = Gstr1ExcelFormatter.toWorkbook(sections);
    const wb = XLSX.read(buf, { type: 'buffer' });

    expect(wb.SheetNames).toEqual(['B2B', 'B2CS', 'CDNR', 'HSN', 'DOC']);

    const rowCount = (sheetName: string): number => {
      const ws = wb.Sheets[sheetName];
      if (!ws) return -1;
      const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1');
      return range.e.r - range.s.r + 1;
    };

    expect(rowCount('B2B')).toBe(sections.b2b.length + 1);
    expect(rowCount('B2CS')).toBe(sections.b2cs.length + 1);
    expect(rowCount('CDNR')).toBe(sections.cdnr.length + 1);
    expect(rowCount('HSN')).toBe(sections.hsn.data.length + 1);
    expect(rowCount('DOC')).toBe(sections.doc.flatMap((d) => d.docDet).length + 1);
  });
});

describe('Gstr1ExcelFormatter metadata', () => {
  it('getContentType returns the spreadsheet MIME type', () => {
    expect(Gstr1ExcelFormatter.getContentType()).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
  });

  it('getFileName builds a period-scoped .xlsx filename', () => {
    expect(Gstr1ExcelFormatter.getFileName('2025-06')).toBe('gstr1-2025-06.xlsx');
  });
});
