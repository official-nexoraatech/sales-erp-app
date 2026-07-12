import type { CompletedSale } from './components/pos/types.js';

const ESC = 0x1b;
const GS = 0x1d;

export function cmdInit(): number[] {
  return [ESC, 0x40];
}

export function cmdBold(on: boolean): number[] {
  return [ESC, 0x45, on ? 1 : 0];
}

export function cmdAlign(align: 'left' | 'center' | 'right'): number[] {
  const n = align === 'center' ? 1 : align === 'right' ? 2 : 0;
  return [ESC, 0x61, n];
}

export function cmdFeed(lines: number): number[] {
  return [ESC, 0x64, lines];
}

// GS V m — m=0 is a full cut (no feed). Callers that want trailing whitespace
// above the cut line should emit cmdFeed() first.
export function cmdCut(): number[] {
  return [GS, 0x56, 0x00];
}

// ESC p m t1 t2 — drawer-kick pulse. m selects the drawer pin (0 = pin 2, the
// common default wiring on Epson-compatible controllers); t1/t2 are the on/off
// pulse widths in printer-defined units (~2ms each on most controllers).
export function cmdDrawerKick(pin: 0 | 1 = 0, onTime = 25, offTime = 250): number[] {
  return [ESC, 0x70, pin, onTime, offTime];
}

function textLine(s: string): number[] {
  return [...new TextEncoder().encode(s), 0x0a];
}

// Right-pads `left` and right-aligns `right` within `width` characters, the
// same layout an actual thermal receipt uses for an item/price or label/total row.
function twoColumn(left: string, right: string, width: number): string {
  const space = Math.max(1, width - left.length - right.length);
  return left + ' '.repeat(space) + right;
}

export interface EscPosOptions {
  // 32 for 58mm paper, 42 for 80mm — default matches this app's 80mm default.
  paperWidthChars?: number;
  drawerKick?: boolean;
}

// ESC/POS printers use device-specific codepages that don't reliably include
// ₹ — "Rs." is used instead of the on-screen ₹ symbol for guaranteed
// cross-printer rendering.
export function buildReceipt(sale: CompletedSale, opts: EscPosOptions = {}): Uint8Array {
  const width = opts.paperWidthChars ?? 42;
  const out: number[] = [];
  out.push(...cmdInit());
  out.push(...cmdAlign('center'));
  out.push(...cmdBold(true));
  out.push(...textLine('RECEIPT'));
  out.push(...cmdBold(false));
  out.push(...textLine(sale.invoiceNumber));
  out.push(...cmdAlign('left'));
  out.push(...textLine('-'.repeat(width)));
  if (sale.customer) out.push(...textLine(`Customer: ${sale.customer.displayName}`));
  for (const l of sale.lines) {
    out.push(
      ...textLine(twoColumn(`${l.itemName} x${l.quantity}`, `Rs.${l.lineTotal.toFixed(2)}`, width))
    );
  }
  out.push(...textLine('-'.repeat(width)));
  out.push(...cmdBold(true));
  out.push(...textLine(twoColumn('Total', `Rs.${sale.grandTotal.toFixed(2)}`, width)));
  out.push(...cmdBold(false));
  out.push(
    ...textLine(
      twoColumn(`Paid via ${sale.paymentMode}`, `Rs.${sale.amountTendered.toFixed(2)}`, width)
    )
  );
  if (sale.change > 0)
    out.push(...textLine(twoColumn('Change', `Rs.${sale.change.toFixed(2)}`, width)));
  out.push(...cmdFeed(3));
  if (opts.drawerKick) out.push(...cmdDrawerKick());
  out.push(...cmdCut());
  return new Uint8Array(out);
}

// A standalone kick, independent of printing — for a cashier who wants the
// drawer to pop without reprinting a receipt.
export function buildDrawerKickOnly(): Uint8Array {
  return new Uint8Array(cmdDrawerKick());
}
