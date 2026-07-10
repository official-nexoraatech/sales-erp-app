import * as XLSX from 'xlsx';
import type { Gstr1B2BEntry, Gstr1B2CSEntry, Gstr1HsnEntry, Gstr1Section } from './Gstr1Service.js';

function sheetFromRows(headers: string[], rows: (string | number)[][]): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);

  const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1');
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cellAddress = XLSX.utils.encode_cell({ r: 0, c });
    if (!ws[cellAddress]) continue;
    ws[cellAddress].s = { font: { bold: true } };
  }

  ws['!cols'] = headers.map((h) => ({ wch: Math.max(h.length + 2, 12) }));
  return ws;
}

const B2B_HEADERS = [
  'GSTIN', 'Receiver Name', 'Invoice Number', 'Invoice Date', 'Invoice Value',
  'Place of Supply', 'Reverse Charge', 'Rate', 'Taxable Value', 'CGST', 'SGST', 'IGST', 'Cess',
];

function b2bRow(e: Gstr1B2BEntry): (string | number)[] {
  return [
    e.gstin, e.receiverName, e.invoiceNumber, e.invoiceDate, e.invoiceValue,
    e.placeOfSupply, e.reverseCharge ? 'Y' : 'N', e.rate, e.taxableValue,
    e.cgstAmount, e.sgstAmount, e.igstAmount, e.cessAmount,
  ];
}

const B2CS_HEADERS = ['Type', 'Place of Supply', 'Rate', 'Taxable Value', 'CGST', 'SGST', 'E-Commerce GSTIN'];

function b2csRow(e: Gstr1B2CSEntry): (string | number)[] {
  return [e.type, e.placeOfSupply, e.rate, e.taxableValue, e.cgstAmount, e.sgstAmount, e.eCommerceGstin];
}

const HSN_HEADERS = [
  'HSN/SAC', 'Description', 'UQC', 'Total Quantity', 'Total Value',
  'Taxable Value', 'Rate', 'IGST', 'CGST', 'SGST', 'Cess',
];

function hsnRow(e: Gstr1HsnEntry): (string | number)[] {
  return [
    e.hsnSac, e.description, e.uqc, e.totalQuantity, e.totalValue,
    e.taxableValue, e.rate, e.igstAmount, e.cgstAmount, e.sgstAmount, e.cessAmount,
  ];
}

const DOC_HEADERS = ['Doc Num', 'From', 'To', 'Total Number', 'Cancelled', 'Net Issued'];

export class Gstr1ExcelFormatter {
  static toWorkbook(sections: Gstr1Section): Buffer {
    const wb = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(wb, sheetFromRows(B2B_HEADERS, sections.b2b.map(b2bRow)), 'B2B');
    XLSX.utils.book_append_sheet(wb, sheetFromRows(B2CS_HEADERS, sections.b2cs.map(b2csRow)), 'B2CS');
    XLSX.utils.book_append_sheet(wb, sheetFromRows(B2B_HEADERS, sections.cdnr.map(b2bRow)), 'CDNR');
    XLSX.utils.book_append_sheet(wb, sheetFromRows(HSN_HEADERS, sections.hsn.data.map(hsnRow)), 'HSN');

    const docRows = sections.doc
      .flatMap((d) => d.docDet)
      .map((d): (string | number)[] => [d.docNum, d.from, d.to, d.totnum, d.cancel, d.net]);
    XLSX.utils.book_append_sheet(wb, sheetFromRows(DOC_HEADERS, docRows), 'DOC');

    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }

  static getContentType(): string {
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }

  static getFileName(period: string): string {
    return `gstr1-${period}.xlsx`;
  }
}
