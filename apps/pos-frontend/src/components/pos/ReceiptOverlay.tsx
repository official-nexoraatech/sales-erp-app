import { useState, useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import { MessageCircle, Mail, Printer, Usb, X } from 'lucide-react';
import { authFetch } from '../../auth.js';
import { buildReceipt } from '../../escpos.js';
import { supportsAnyPrinting, writeToPairedPrinter } from '../../webPrinter.js';
import { useFocusTrap } from '../../hooks/useFocusTrap.js';
import type { CompletedSale } from './types.js';
import POSButton from './POSButton.js';
import { ReferralQr } from './ReferralQr.js';

// Routed through api-gateway rather than calling sales-service directly by port — see
// apps/web-frontend/src/api/client.ts's header comment for why.
const SALES_API = import.meta.env['VITE_SALES_API_URL'] ?? 'http://localhost:3000/api/sales';

const PAPER_SIZES: Record<
  'A4' | '80mm' | '58mm',
  { pageSize: string; widthMm: number; widthChars: number | null }
> = {
  A4: { pageSize: 'A4', widthMm: 190, widthChars: null },
  '80mm': { pageSize: '80mm auto', widthMm: 76, widthChars: 42 },
  '58mm': { pageSize: '58mm auto', widthMm: 54, widthChars: 32 },
};

export function ReceiptOverlay({ sale, onClose }: { sale: CompletedSale; onClose: () => void }) {
  const [paperSize, setPaperSize] = useState<'A4' | '80mm' | '58mm'>(
    () => (localStorage.getItem('pos_paper_size') as 'A4' | '80mm' | '58mm') || '80mm'
  );
  const [sending, setSending] = useState(false);
  const [hwPrinting, setHwPrinting] = useState(false);
  const [referralLink, setReferralLink] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem('pos_paper_size', paperSize);
  }, [paperSize]);

  // CRM-ROADMAP Phase 2, Feature 4 — get-or-create the paying customer's own referral code for
  // the receipt QR. Best-effort: a failure here must never block the receipt from rendering.
  useEffect(() => {
    if (!sale.customer) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch(`${SALES_API}/referral-codes/${sale.customer!.id}`);
        if (!res.ok) return;
        const json = (await res.json()) as { data?: { code?: string } };
        if (!cancelled && json.data?.code) {
          setReferralLink(`${SALES_API}/r/${json.data.code}`);
        }
      } catch {
        // best-effort — no referral QR is not a receipt-blocking failure
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sale.customer]);

  // This is the one modal-like surface in the app not built on POSDialog (it needs its own
  // always-black-on-white print styling, not POSDialog's themed shell) — matching POSDialog's
  // Escape-to-close/focus-trap/aria-modal behavior directly rather than leaving it as the only
  // screen a cashier sees on every single completed sale with no keyboard/screen-reader
  // semantics at all. Always "open" while mounted — POSScreen only renders this when there's a
  // completed sale to show.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  useFocusTrap(panelRef, true);

  // WebUSB/Web Serial raw ESC/POS printing — feature-detected, additional to
  // (never a replacement for) the window.print() button below. Absent on
  // Safari/iOS and any browser lacking both APIs, per OFFLINE-06's
  // supportsBackgroundSync() precedent for partial-support browser APIs.
  const printViaHardware = async (widthChars: number) => {
    setHwPrinting(true);
    try {
      const data = buildReceipt(sale, { paperWidthChars: widthChars, drawerKick: true });
      await writeToPairedPrinter(data);
      toast.success('Sent to connected printer');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to reach connected printer');
    } finally {
      setHwPrinting(false);
    }
  };

  const sendReceipt = async (channel: 'WHATSAPP' | 'EMAIL') => {
    setSending(true);
    try {
      const res = await authFetch(`${SALES_API}/pos/sales/${sale.invoiceId}/send-receipt`, {
        method: 'POST',
        body: JSON.stringify({ channel }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? 'Failed to send receipt');
      }
      toast.success(`Receipt sent via ${channel === 'WHATSAPP' ? 'WhatsApp' : 'Email'}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to send receipt');
    } finally {
      setSending(false);
    }
  };

  const size = PAPER_SIZES[paperSize];

  return (
    <div
      className="fixed inset-0 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm print:bg-white print:static print:p-0 print:block"
      style={{ zIndex: 'var(--z-modal)' }}
    >
      <style>{`@media print { @page { size: ${size.pageSize}; margin: ${paperSize === 'A4' ? '10mm' : '2mm'}; } }`}</style>
      {/* Receipt content is always rendered black-on-white, independent of app theme —
          it represents physical thermal/A4 paper output, not an on-screen surface. */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="receipt-overlay-title"
        className="relative bg-white text-black rounded-2xl shadow-token-modal p-4 max-h-[90vh] overflow-y-auto print:rounded-none print:max-h-none print:overflow-visible print:mx-auto print:shadow-none"
        style={{ width: `${size.widthMm}mm`, maxWidth: '100%' }}
      >
        <button
          onClick={onClose}
          aria-label="Close receipt"
          className="absolute top-2 right-2 flex items-center justify-center w-9 h-9 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 print:hidden"
        >
          <X size={18} />
        </button>

        <div className="text-center mb-3">
          <div id="receipt-overlay-title" className="font-bold text-lg">
            Receipt
          </div>
          <div className="text-xs text-gray-600">{sale.invoiceNumber}</div>
          {!sale.synced && (
            <div className="text-xs text-amber-700 font-medium mt-1 print:hidden">
              Saved offline — will sync when back online
            </div>
          )}
        </div>
        {sale.customer && <div className="text-xs mb-2">Customer: {sale.customer.displayName}</div>}
        <table className="w-full text-xs mb-2">
          <tbody>
            {sale.lines.map((l) => (
              <tr key={l.itemId}>
                <td className="py-0.5">
                  {l.itemName} x{l.quantity}
                </td>
                <td className="py-0.5 text-right">₹{l.lineTotal.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="border-t border-dashed border-gray-400 pt-2 text-sm space-y-0.5">
          <div className="flex justify-between font-bold">
            <span>Total</span>
            <span>₹{sale.grandTotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span>Paid via {sale.paymentMode}</span>
            <span>₹{sale.amountTendered.toFixed(2)}</span>
          </div>
          {sale.change > 0 && (
            <div className="flex justify-between text-xs">
              <span>Change</span>
              <span>₹{sale.change.toFixed(2)}</span>
            </div>
          )}
        </div>

        {referralLink && (
          <div className="mt-3 border-t border-dashed border-gray-400 pt-2 text-center">
            <p className="text-xs font-semibold mb-1">Refer a friend, you both earn rewards!</p>
            <ReferralQr referralLink={referralLink} />
          </div>
        )}

        <div className="mt-4 flex flex-col gap-2 print:hidden">
          <div className="flex gap-1">
            {(['58mm', '80mm', 'A4'] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPaperSize(p)}
                className={`flex-1 py-1.5 min-h-[36px] text-xs font-medium rounded-lg border-2 transition-colors ${
                  paperSize === p
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                    : 'border-gray-200 text-gray-600'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
          <POSButton variant="primary" onClick={() => window.print()} className="w-full">
            <Printer size={16} />
            Print Receipt
          </POSButton>
          {supportsAnyPrinting() && size.widthChars !== null && (
            <POSButton
              variant="outline"
              disabled={hwPrinting}
              loading={hwPrinting}
              onClick={() => void printViaHardware(size.widthChars!)}
              className="w-full"
            >
              <Usb size={16} />
              Print via connected printer
            </POSButton>
          )}
          {sale.synced && sale.customer && (
            <div className="flex gap-2">
              <POSButton
                variant="success"
                disabled={sending}
                onClick={() => void sendReceipt('WHATSAPP')}
                className="flex-1"
                size="sm"
              >
                <MessageCircle size={15} />
                WhatsApp
              </POSButton>
              <POSButton
                variant="secondary"
                disabled={sending}
                onClick={() => void sendReceipt('EMAIL')}
                className="flex-1"
                size="sm"
              >
                <Mail size={15} />
                Email
              </POSButton>
            </div>
          )}
          <POSButton variant="outline" onClick={onClose} className="w-full">
            New Sale
          </POSButton>
        </div>
      </div>
    </div>
  );
}
