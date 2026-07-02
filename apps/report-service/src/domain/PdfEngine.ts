import Handlebars from 'handlebars';
import puppeteer, { type Browser } from 'puppeteer';
import { createLogger } from '@erp/logger';
import { BusinessError } from '@erp/types';
import {
  TAX_INVOICE_TEMPLATE,
  QUOTATION_TEMPLATE,
  DELIVERY_CHALLAN_TEMPLATE,
  PURCHASE_ORDER_TEMPLATE,
  PAYMENT_RECEIPT_TEMPLATE,
  SALARY_SLIP_TEMPLATE,
} from '../templates/index.js';

const logger = createLogger({ serviceName: 'report-service' });

export type DocumentType =
  | 'TAX_INVOICE'
  | 'QUOTATION'
  | 'DELIVERY_CHALLAN'
  | 'PURCHASE_ORDER'
  | 'PAYMENT_RECEIPT'
  | 'SALARY_SLIP';

const TEMPLATE_MAP: Record<DocumentType, string> = {
  TAX_INVOICE: TAX_INVOICE_TEMPLATE,
  QUOTATION: QUOTATION_TEMPLATE,
  DELIVERY_CHALLAN: DELIVERY_CHALLAN_TEMPLATE,
  PURCHASE_ORDER: PURCHASE_ORDER_TEMPLATE,
  PAYMENT_RECEIPT: PAYMENT_RECEIPT_TEMPLATE,
  SALARY_SLIP: SALARY_SLIP_TEMPLATE,
};

// Register Handlebars helpers for Indian locale formatting
Handlebars.registerHelper('inrFormat', (value: number) => {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(value ?? 0);
});
Handlebars.registerHelper('dateFormat', (date: string | Date) => {
  if (!date) return '';
  return new Date(date).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
});
Handlebars.registerHelper('numberWords', (num: number) => numberToWords(num));
Handlebars.registerHelper('ifEquals', function (this: unknown, a: unknown, b: unknown, options: Handlebars.HelperOptions) {
  return a === b ? options.fn(this) : options.inverse(this);
});

export interface PdfGenerateOptions {
  documentType: DocumentType;
  data: Record<string, unknown>;
  orientation?: 'portrait' | 'landscape';
}

export class PdfEngine {
  private browser: Browser | null = null;

  async init(): Promise<void> {
    this.browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });
  }

  async close(): Promise<void> {
    await this.browser?.close();
  }

  async generate(options: PdfGenerateOptions): Promise<Buffer> {
    const template = TEMPLATE_MAP[options.documentType];
    if (!template) {
      throw new BusinessError('UNKNOWN_DOCUMENT_TYPE', `Unknown document type: ${options.documentType}`);
    }

    if (!this.browser) {
      throw new BusinessError('PDF_ENGINE_NOT_INITIALIZED', 'PdfEngine.init() must be called first');
    }

    const compiled = Handlebars.compile(template);
    const html = compiled(options.data);

    const page = await this.browser.newPage();
    try {
      await page.setContent(html, { waitUntil: 'networkidle0' });

      const pdf = await page.pdf({
        format: 'A4',
        landscape: options.orientation === 'landscape',
        printBackground: true,
        margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
      });

      logger.info({ documentType: options.documentType }, 'PDF generated');
      return Buffer.from(pdf);
    } finally {
      await page.close();
    }
  }
}

// Indian number-to-words conversion (up to crores)
function numberToWords(amount: number): string {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen',
    'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function convertBelow100(n: number): string {
    if (n < 20) return ones[n] ?? '';
    return (tens[Math.floor(n / 10)] ?? '') + (n % 10 !== 0 ? ' ' + (ones[n % 10] ?? '') : '');
  }

  function convert(n: number): string {
    if (n === 0) return '';
    if (n < 100) return convertBelow100(n);
    if (n < 1000) return (ones[Math.floor(n / 100)] ?? '') + ' Hundred' + (n % 100 !== 0 ? ' ' + convertBelow100(n % 100) : '');
    if (n < 100000) return convert(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 !== 0 ? ' ' + convert(n % 1000) : '');
    if (n < 10000000) return convert(Math.floor(n / 100000)) + ' Lakh' + (n % 100000 !== 0 ? ' ' + convert(n % 100000) : '');
    return convert(Math.floor(n / 10000000)) + ' Crore' + (n % 10000000 !== 0 ? ' ' + convert(n % 10000000) : '');
  }

  const rupees = Math.floor(amount);
  const paise = Math.round((amount - rupees) * 100);
  let result = 'Rupees ' + (convert(rupees) || 'Zero');
  if (paise > 0) result += ' and ' + convert(paise) + ' Paise';
  return result + ' Only';
}
