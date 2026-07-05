import React, { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import JsBarcode from 'jsbarcode';
import { toString as qrToString } from 'qrcode';
import toast from 'react-hot-toast';
import { Printer, Search } from 'lucide-react';
import { itemApi } from '../../api/endpoints';
import type { ItemListItem } from '../../api/endpoints';
import { Button } from '../../components/ui/Button';
import { Loader } from '../../components/ui/Loader';
import { useAuth } from '../../hooks/useAuth';
import { useDebounce } from '../../hooks/useDebounce';
import { formatCurrency } from '../../utils/formatCurrency';

type BarcodeType = 'CODE128' | 'CODE39' | 'QR_CODE';
type LinearBarcodeType = Exclude<BarcodeType, 'QR_CODE'>;
type LabelSizeValue = '100x50' | '100x25' | '50x25';

interface LabelOption {
  value: LabelSizeValue;
  label: string;
  widthMm: number;
  heightMm: number;
}

interface LabelTierStyle {
  padding: string;
  gap: string;
  orgFontSize: string;
  itemFontSize: string;
  priceFontSize: string;
  mrpFontSize: string;
  idFontSize: string;
  barcodeHeight: number;
  barcodeWidth: number;
  barcodeFontSize: number;
  qrSize: number;
}

const inputClass = 'h-10 w-full rounded border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-gray-50';
const tableHeadings = ['ITEM ID', 'ITEM', 'ITEM CODE', 'SKU', 'BARCODE VALUE', 'HSN', 'CATEGORY', 'BRAND', 'PURCHASE PRICE', 'SALE PRICE', 'MRP', 'QTY', 'UNIT', 'TRACKING', 'STATUS'];
const labelOptions: LabelOption[] = [
  { value: '100x50', label: '100 x 50mm', widthMm: 100, heightMm: 50 },
  { value: '100x25', label: '100 x 25mm', widthMm: 100, heightMm: 25 },
  { value: '50x25', label: '50 x 25mm', widthMm: 50, heightMm: 25 },
];

// Every side of a label gets the same padding value, and each label size has
// its own tuned font/barcode scale so the three options render distinctly
// instead of collapsing into one "compact" look.
const LABEL_TIERS: Record<LabelSizeValue, LabelTierStyle> = {
  '100x50': {
    padding: '3.5mm',
    gap: '1.5mm',
    orgFontSize: '11px',
    itemFontSize: '13px',
    priceFontSize: '14px',
    mrpFontSize: '10px',
    idFontSize: '9px',
    barcodeHeight: 58,
    barcodeWidth: 1.6,
    barcodeFontSize: 13,
    qrSize: 118,
  },
  '100x25': {
    padding: '2mm',
    gap: '0.8mm',
    orgFontSize: '8px',
    itemFontSize: '9px',
    priceFontSize: '9.5px',
    mrpFontSize: '7px',
    idFontSize: '6.5px',
    barcodeHeight: 26,
    barcodeWidth: 1.3,
    barcodeFontSize: 9,
    qrSize: 58,
  },
  '50x25': {
    padding: '1.5mm',
    gap: '0.6mm',
    orgFontSize: '6.5px',
    itemFontSize: '7.5px',
    priceFontSize: '8px',
    mrpFontSize: '6px',
    idFontSize: '5.5px',
    barcodeHeight: 22,
    barcodeWidth: 1,
    barcodeFontSize: 7,
    qrSize: 44,
  },
};

const itemCodeValue = (item: ItemListItem) => String(item.id);
const availableBarcodeCount = (item: ItemListItem | null) => Math.max(0, Math.floor(Number(item?.availableQty ?? 0)));
const statusText = (status: boolean | string) => (status === true || status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE');
const labelOptionByValue = (value: LabelSizeValue) => labelOptions.find((option) => option.value === value) || labelOptions[0];

const BarcodeSvg = ({ value, type, tier }: { value: string; type: LinearBarcodeType; tier: LabelTierStyle }) => {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    if (!svgRef.current) return;
    try {
      JsBarcode(svgRef.current, value, {
        format: type,
        width: tier.barcodeWidth,
        height: tier.barcodeHeight,
        displayValue: true,
        fontSize: tier.barcodeFontSize,
        margin: 0,
        lineColor: '#111827',
        background: '#ffffff',
      });
    } catch {
      svgRef.current.replaceChildren();
    }
  }, [tier, type, value]);

  return <svg ref={svgRef} className="max-w-full" style={{ maxHeight: tier.barcodeHeight + tier.barcodeFontSize + 6 }} />;
};

const QrSvg = ({ value, size }: { value: string; size: number }) => {
  const [markup, setMarkup] = useState('');

  useEffect(() => {
    let active = true;
    setMarkup('');
    qrToString(value, {
      type: 'svg',
      width: size,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#111827', light: '#ffffff' },
    }).then((svg) => {
      if (active) setMarkup(svg);
    }).catch(() => {
      if (active) setMarkup('');
    });

    return () => {
      active = false;
    };
  }, [size, value]);

  return (
    <div
      className="qr-code shrink-0 overflow-hidden [&_svg]:block [&_svg]:h-full [&_svg]:w-full"
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
};

const BarcodePreview = ({ item, type, label, organizationName }: { item: ItemListItem; type: BarcodeType; label: LabelOption; organizationName: string }) => {
  const value = itemCodeValue(item);
  const tier = LABEL_TIERS[label.value];
  const labelStyle: React.CSSProperties = {
    width: `${label.widthMm}mm`,
    height: `${label.heightMm}mm`,
    padding: tier.padding,
    gap: tier.gap,
  };

  return (
    <div
      className="barcode-label box-border flex shrink-0 flex-col items-center justify-center overflow-hidden rounded border border-dashed border-gray-300 bg-white text-center"
      style={labelStyle}
      data-label-size={label.value}
    >
      <div className="max-w-full truncate font-bold uppercase tracking-wide text-gray-900" style={{ fontSize: tier.orgFontSize, lineHeight: 1.1 }}>
        {organizationName}
      </div>
      <div className="max-w-full truncate font-semibold text-gray-900" style={{ fontSize: tier.itemFontSize, lineHeight: 1.15 }}>
        {item.itemName}
      </div>
      {type === 'QR_CODE' ? <QrSvg value={value} size={tier.qrSize} /> : <BarcodeSvg value={value} type={type} tier={tier} />}
      <div className="flex max-w-full items-baseline gap-1.5 leading-tight">
        <span className="font-medium text-gray-500" style={{ fontSize: tier.mrpFontSize }}>MRP: {formatCurrency(item.mrp || 0)}</span>
        <span className="font-bold text-gray-900" style={{ fontSize: tier.priceFontSize }}>{formatCurrency(item.salePrice || 0)}</span>
      </div>
      <div className="font-semibold uppercase text-gray-500" style={{ fontSize: tier.idFontSize, lineHeight: 1.1 }}>Item ID: {value}</div>
    </div>
  );
};

export const GenerateBarcodePage: React.FC = () => {
  const { user } = useAuth();
  const organizationName = user?.organizationName || '';
  const [barcodeType, setBarcodeType] = useState<LinearBarcodeType>('CODE128');
  const [labelSize, setLabelSize] = useState<LabelSizeValue>(labelOptions[0].value);
  const [search, setSearch] = useState('');
  const [selectedItemId, setSelectedItemId] = useState(0);
  const [selectedItem, setSelectedItem] = useState<ItemListItem | null>(null);
  const [generatedItem, setGeneratedItem] = useState<ItemListItem | null>(null);
  const [generatedType, setGeneratedType] = useState<BarcodeType>('CODE128');
  const barcodeSectionRef = useRef<HTMLDivElement | null>(null);
  const debouncedSearch = useDebounce(search);

  const items = useQuery({
    queryKey: ['barcode-items', debouncedSearch],
    queryFn: () => itemApi.getAll({ page: 0, size: 20, search: debouncedSearch }),
  });

  const searchResults = items.data?.data?.content || [];
  const generatedCount = availableBarcodeCount(generatedItem);
  const selectedLabel = labelOptionByValue(labelSize);

  const selectItem = (itemId: number) => {
    setSelectedItemId(itemId);
    const item = searchResults.find((entry) => entry.id === itemId) || null;
    setSelectedItem(item);
    setGeneratedItem(null);
  };

  const generateCode = (type: BarcodeType) => {
    if (!selectedItem) {
      toast.error('Select an item first');
      return;
    }
    if (availableBarcodeCount(selectedItem) <= 0) {
      toast.error('Selected item has no available quantity');
      return;
    }
    setGeneratedType(type);
    setGeneratedItem(selectedItem);
  };

  const printBarcode = () => {
    if (!generatedItem || !barcodeSectionRef.current) {
      toast.error('Generate barcode first');
      return;
    }

    const popup = window.open('', '_blank', 'width=900,height=700');
    if (!popup) return;
    popup.document.write(`
      <html>
        <head>
          <title>Barcode - ${generatedItem.itemName}</title>
          <style>
            /* Zero the browser's default page margin so every printed label gets
               identical, predictable spacing on all sides — the label's own
               padding (set inline per element below) is the only spacing. */
            @page { margin: 0; size: auto; }
            * { box-sizing: border-box; }
            body { font-family: Arial, sans-serif; margin: 0; padding: 4mm; }
            .barcode-print-grid {
              display: grid;
              grid-template-columns: repeat(auto-fit, minmax(${selectedLabel.widthMm}mm, ${selectedLabel.widthMm}mm));
              gap: 3mm;
              align-items: start;
            }
            .barcode-print-grid > div { break-inside: avoid; display: flex; justify-content: center; }
            .barcode-label {
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              overflow: hidden;
              border: 1px dashed #d1d5db;
              border-radius: 4px;
              background: #ffffff;
              text-align: center;
            }
            .qr-code { flex-shrink: 0; overflow: hidden; }
            .qr-code svg { display: block; width: 100%; height: 100%; }
            svg { max-width: 100%; }
          </style>
        </head>
        <body>
          <div class="barcode-print-grid">${barcodeSectionRef.current.innerHTML}</div>
          <script>window.onload = () => window.print();</script>
        </body>
      </html>
    `);
    popup.document.close();
  };

  return (
    <div className="space-y-5">
      <div className="text-sm text-gray-500">Home &gt; Utilities &gt; Generate Barcode</div>

      <div className="overflow-hidden rounded-lg bg-white shadow">
        <div className="border-b px-5 py-4">
          <h1 className="text-xl font-semibold text-gray-900">Generate Barcode</h1>
        </div>

        <div className="space-y-6 p-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="text-sm text-gray-600">
              Barcode Type
              <select className={`${inputClass} mt-1`} value={barcodeType} onChange={(event) => setBarcodeType(event.target.value as LinearBarcodeType)}>
                <option value="CODE128">1D Code 128</option>
                <option value="CODE39">1D Code 39</option>
              </select>
            </label>
            <label className="text-sm text-gray-600">
              Label Size
              <select className={`${inputClass} mt-1`} value={labelSize} onChange={(event) => setLabelSize(event.target.value as LabelSizeValue)}>
                {labelOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(240px,1fr)_minmax(260px,1fr)]">
            <label className="block text-sm text-gray-600">
              Search Item
              <div className="mt-1 flex">
                <span className="flex h-10 w-11 items-center justify-center rounded-l border border-r-0 border-gray-300 text-blue-500">
                  <Search size={16} />
                </span>
                <input
                  className="h-10 flex-1 rounded-r border border-gray-300 px-3 text-sm outline-none focus:ring-2 focus:ring-blue-100"
                  placeholder="Scan Barcode/Search Item/Brand Name"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setSelectedItemId(0);
                    setSelectedItem(null);
                    setGeneratedItem(null);
                  }}
                />
              </div>
            </label>
            <label className="block text-sm text-gray-600">
              Item Name
              <select className={`${inputClass} mt-1`} value={selectedItemId} disabled={items.isLoading} onChange={(event) => selectItem(Number(event.target.value))}>
                <option value={0}>{items.isLoading ? 'Loading items...' : 'Select item'}</option>
                {searchResults.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.itemName} {item.sku ? `- ${item.sku}` : ''} (ID: {item.id})
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[1300px] text-sm">
              <thead>
                <tr>
                  {tableHeadings.map((heading) => (
                    <th key={heading} className="border bg-white p-3 text-left font-semibold text-gray-900">{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {selectedItem ? (
                  <tr className="even:bg-gray-50">
                    <td className="border p-3 font-semibold">{selectedItem.id}</td>
                    <td className="border p-3 font-semibold">{selectedItem.itemName}</td>
                    <td className="border p-3">{selectedItem.itemCode || 'N/A'}</td>
                    <td className="border p-3">{selectedItem.sku || 'N/A'}</td>
                    <td className="border p-3">{itemCodeValue(selectedItem)}</td>
                    <td className="border p-3">{selectedItem.hsnCode || 'N/A'}</td>
                    <td className="border p-3">{selectedItem.categoryName || 'N/A'}</td>
                    <td className="border p-3">{selectedItem.brandName || 'N/A'}</td>
                    <td className="border p-3">{formatCurrency(selectedItem.purchasePrice || 0)}</td>
                    <td className="border p-3">{formatCurrency(selectedItem.salePrice || 0)}</td>
                    <td className="border p-3">{formatCurrency(selectedItem.mrp || 0)}</td>
                    <td className="border p-3">{selectedItem.availableQty ?? 0}</td>
                    <td className="border p-3">{selectedItem.unitName || 'N/A'}</td>
                    <td className="border p-3">{selectedItem.trackingType || 'Regular'}</td>
                    <td className="border p-3">{statusText(selectedItem.status)}</td>
                  </tr>
                ) : (
                  <tr>
                    <td colSpan={tableHeadings.length} className="border bg-gray-100 p-3 text-center italic text-gray-700">No item is selected yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex gap-3 border-t p-5">
          <Button type="button" onClick={() => generateCode(barcodeType)}>Generate Barcode</Button>
          <Button type="button" variant="outline" onClick={() => generateCode('QR_CODE')}>Generate QR Code</Button>
          <Button type="button" variant="secondary" onClick={() => {
            setSearch('');
            setSelectedItemId(0);
            setSelectedItem(null);
            setGeneratedItem(null);
            setGeneratedType(barcodeType);
          }}>Close</Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg bg-white shadow">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 className="text-xl font-semibold text-gray-900">Barcodes</h2>
          <button type="button" className="inline-flex items-center gap-2 rounded border border-green-500 px-4 py-2 text-sm font-semibold text-green-600 hover:bg-green-50" onClick={printBarcode}>
            <Printer size={16} />
            Print
          </button>
        </div>
        <div className="min-h-[220px] bg-white p-5">
          {generatedItem ? (
            <>
              <p className="mb-4 text-sm font-semibold text-gray-700">Generated {generatedCount} barcode{generatedCount === 1 ? '' : 's'} from available quantity.</p>
              <div
                ref={barcodeSectionRef}
                className="grid gap-3"
                style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(${selectedLabel.widthMm}mm, 31%), 1fr))` }}
              >
              {Array.from({ length: generatedCount }).map((_, index) => (
                <div key={`${generatedItem.id}-${index}`} className="flex justify-center">
                  <BarcodePreview item={generatedItem} type={generatedType} label={selectedLabel} organizationName={organizationName} />
                </div>
              ))}
              </div>
            </>
          ) : (
            <div className="flex min-h-[190px] items-center justify-center rounded border border-dashed border-gray-300 text-sm italic text-gray-500">
              Select an item and click Generate Barcode.
            </div>
          )}
        </div>
      </div>

      {items.isFetching && !items.isLoading && <div className="fixed bottom-5 right-5 rounded bg-white px-4 py-3 shadow"><Loader size="sm" /></div>}
    </div>
  );
};
