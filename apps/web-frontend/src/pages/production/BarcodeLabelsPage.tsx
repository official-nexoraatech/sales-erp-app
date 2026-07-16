import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';
import { productionApi, itemApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import Button from '../../components/ui/Button.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';

interface ItemOption {
  id: number;
  name: string;
  mrp?: string | null;
}

interface PrintBarcode {
  id: number;
  value: string;
  format: 'EAN13' | 'CODE128' | 'QR';
}

interface PrintData {
  item: { name: string; mrp: string; variantLabel?: string };
  barcodes: PrintBarcode[];
}

const LABEL_SIZES: Record<string, { label: string; widthMm: number; heightMm: number }> = {
  LABEL_40x25: { label: '40 x 25 mm', widthMm: 40, heightMm: 25 },
  LABEL_50x25: { label: '50 x 25 mm', widthMm: 50, heightMm: 25 },
  LABEL_60x40: { label: '60 x 40 mm', widthMm: 60, heightMm: 40 },
  LABEL_100x50: { label: '100 x 50 mm', widthMm: 100, heightMm: 50 },
  A4_SHEET: { label: 'A4 sheet (multiple labels)', widthMm: 45, heightMm: 25 },
};

function BarcodeSvg({ value, format }: { value: string; format: 'EAN13' | 'CODE128' }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    try {
      JsBarcode(ref.current, value, {
        format: format === 'EAN13' ? 'EAN13' : 'CODE128',
        width: 1.5,
        height: 40,
        displayValue: true,
        fontSize: 11,
        margin: 4,
      });
    } catch {
      // invalid value for the chosen symbology (e.g. non-numeric EAN13) — leave blank rather than crash the page
    }
  }, [value, format]);
  return <svg ref={ref} />;
}

function QrDiv({ value }: { value: string }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    let cancelled = false;
    void QRCode.toString(value, { type: 'svg', margin: 1, width: 90 }).then((s) => {
      if (!cancelled) setSvg(s);
    });
    return () => {
      cancelled = true;
    };
  }, [value]);
  return <div dangerouslySetInnerHTML={{ __html: svg }} />;
}

function LabelCard({
  item,
  barcode,
  sizeMm,
}: {
  item: PrintData['item'];
  barcode: PrintBarcode;
  sizeMm: { widthMm: number; heightMm: number };
}) {
  return (
    <div
      className="border border-gray-400 flex flex-col items-center justify-center overflow-hidden bg-white text-black"
      style={{ width: `${sizeMm.widthMm}mm`, height: `${sizeMm.heightMm}mm`, padding: '1mm' }}
    >
      <div className="text-[8px] font-semibold truncate w-full text-center">{item.name}</div>
      {item.mrp && <div className="text-[8px] w-full text-center">MRP ₹{item.mrp}</div>}
      {barcode.format === 'QR' ? (
        <QrDiv value={barcode.value} />
      ) : (
        <BarcodeSvg value={barcode.value} format={barcode.format} />
      )}
    </div>
  );
}

export default function BarcodeLabelsPage() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const [searchParams] = useSearchParams();
  const urlItemId = searchParams.get('itemId');
  const urlItemName = searchParams.get('itemName');
  const [itemSearch, setItemSearch] = useState('');
  const [selectedItem, setSelectedItem] = useState<ItemOption | null>(
    urlItemId && urlItemName ? { id: Number(urlItemId), name: urlItemName } : null
  );
  const [quantity, setQuantity] = useState('1');
  const [format, setFormat] = useState<'EAN13' | 'CODE128' | 'QR'>('CODE128');
  const [printFormat, setPrintFormat] = useState<keyof typeof LABEL_SIZES>('LABEL_40x25');
  const [printData, setPrintData] = useState<PrintData | null>(null);
  const printRef = useRef<HTMLDivElement>(null);

  const { data: itemData } = useQuery({
    queryKey: ['barcode-item-search', itemSearch],
    queryFn: () => itemApi.list({ search: itemSearch }),
    enabled: itemSearch.length > 1 && hasPermission(PERMISSIONS.ITEM_VIEW),
  });
  const itemOptions = ((itemData as Record<string, unknown>)?.content as ItemOption[]) ?? [];

  const generateMutation = useMutation({
    mutationFn: async () => {
      const qty = parseInt(quantity, 10);
      const gen = (await productionApi.generateBarcodes({
        itemId: selectedItem!.id,
        quantity: qty,
        format,
        printFormat,
      })) as { batchId: number };
      return productionApi.getPrintData(gen.batchId) as Promise<PrintData>;
    },
    onSuccess: (data) => setPrintData(data),
    onError: (e: Error) => toast.error(e.message),
  });

  const sizeMm = LABEL_SIZES[printFormat]!;

  function handlePrint() {
    if (!printRef.current) return;
    const popup = window.open('', '_blank', 'width=900,height=700');
    if (!popup) {
      toast.error('Pop-up blocked — allow pop-ups to print labels');
      return;
    }
    popup.document.write(`<!doctype html><html><head><title>Barcode Labels</title><style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: sans-serif; }
      .grid { display: flex; flex-wrap: wrap; gap: 2mm; padding: 4mm; }
      @page { size: auto; margin: 4mm; }
    </style></head><body><div class="grid">${printRef.current.innerHTML}</div>
    <script>window.onload = () => { window.print(); }</script>
    </body></html>`);
    popup.document.close();
  }

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Barcode Labels"
        subtitle="Generate and print barcode/QR labels for items"
      />

      <div className="bg-surface-card rounded-xl border border-default p-6 mb-6 space-y-4">
        <div className="grid grid-cols-4 gap-4">
          <div className="col-span-2 relative">
            <Input
              label="Item"
              required
              placeholder="Search item by name..."
              value={selectedItem ? selectedItem.name : itemSearch}
              onChange={(e) => {
                setSelectedItem(null);
                setItemSearch(e.target.value);
              }}
            />
            {!selectedItem && itemSearch.length > 1 && itemOptions.length > 0 && (
              <div className="absolute z-10 mt-1 w-full border border-default rounded-lg bg-surface-card max-h-40 overflow-y-auto shadow-lg">
                {itemOptions.map((item) => (
                  <button
                    key={item.id}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-surface-raised"
                    onClick={() => {
                      setSelectedItem(item);
                      setItemSearch('');
                    }}
                  >
                    {item.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <Input
            label="Quantity"
            required
            type="number"
            min="1"
            max="1000"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
          <Select
            label="Symbology"
            required
            value={format}
            onChange={(e) => setFormat(e.target.value as typeof format)}
          >
            <option value="CODE128">CODE128</option>
            <option value="EAN13">EAN13</option>
            <option value="QR">QR Code</option>
          </Select>
          <Select
            label="Label size"
            required
            wrapperClassName="col-span-2"
            value={printFormat}
            onChange={(e) => setPrintFormat(e.target.value as typeof printFormat)}
          >
            {Object.entries(LABEL_SIZES).map(([key, v]) => (
              <option key={key} value={key}>
                {v.label}
              </option>
            ))}
          </Select>
          <div className="col-span-2 flex items-end">
            <Button
              disabled={!selectedItem || generateMutation.isPending}
              onClick={() => generateMutation.mutate()}
            >
              {generateMutation.isPending ? 'Generating…' : 'Generate & Preview'}
            </Button>
          </div>
        </div>
      </div>

      {printData && (
        <div className="bg-surface-card rounded-xl border border-default p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-primary">
              Preview — {printData.barcodes.length} label
              {printData.barcodes.length === 1 ? '' : 's'}
            </h3>
            {hasPermission(PERMISSIONS.BARCODE_PRINT) && (
              <Button onClick={handlePrint}>Print Labels</Button>
            )}
          </div>
          <div ref={printRef} className="flex flex-wrap gap-2">
            {printData.barcodes.map((b) => (
              <LabelCard key={b.id} item={printData.item} barcode={b} sizeMm={sizeMm} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
