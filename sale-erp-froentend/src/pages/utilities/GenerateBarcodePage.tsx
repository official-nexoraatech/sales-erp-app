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

const inputClass = 'h-10 w-full rounded border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-gray-50';
const tableHeadings = ['ITEM ID', 'ITEM', 'ITEM CODE', 'SKU', 'BARCODE', 'HSN', 'CATEGORY', 'BRAND', 'PURCHASE PRICE', 'SALE PRICE', 'MRP', 'QTY', 'UNIT', 'TRACKING', 'STATUS'];
const labelOptions: LabelOption[] = [
  { value: '100x50', label: '100 x 50mm', widthMm: 100, heightMm: 50 },
  { value: '100x25', label: '100 x 25mm', widthMm: 100, heightMm: 25 },
  { value: '50x25', label: '50 x 25mm', widthMm: 50, heightMm: 25 },
];

const itemCodeValue = (item: ItemListItem) => String(item.id);
const availableBarcodeCount = (item: ItemListItem | null) => Math.max(0, Math.floor(Number(item?.availableQty ?? 0)));
const statusText = (status: boolean | string) => (status === true || status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE');
const labelOptionByValue = (value: LabelSizeValue) => labelOptions.find((option) => option.value === value) || labelOptions[0];

const BarcodeSvg = ({ value, type, compact }: { value: string; type: LinearBarcodeType; compact: boolean }) => {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    if (!svgRef.current) return;
    try {
      JsBarcode(svgRef.current, value, {
        format: type,
        width: 2,
        height: compact ? 34 : 76,
        displayValue: true,
        fontSize: compact ? 10 : 16,
        margin: compact ? 2 : 8,
        lineColor: '#111827',
        background: '#ffffff',
      });
    } catch {
      svgRef.current.replaceChildren();
    }
  }, [compact, type, value]);

  return <svg ref={svgRef} className={compact ? 'max-h-12 max-w-full' : 'max-h-28 max-w-full'} />;
};

const QrSvg = ({ value, compact }: { value: string; compact: boolean }) => {
  const [markup, setMarkup] = useState('');
  const qrSize = compact ? 48 : 140;

  useEffect(() => {
    let active = true;
    setMarkup('');
    qrToString(value, {
      type: 'svg',
      width: qrSize,
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
  }, [qrSize, value]);

  return (
    <div
      className={`qr-code shrink-0 overflow-hidden ${compact ? 'h-12 w-12' : 'h-36 w-36'} [&_svg]:block [&_svg]:h-full [&_svg]:w-full`}
      style={{ width: qrSize, height: qrSize }}
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
};

const BarcodePreview = ({ item, type, label }: { item: ItemListItem; type: BarcodeType; label: LabelOption }) => {
  const value = itemCodeValue(item);
  const compact = label.heightMm <= 25;
  const labelStyle: React.CSSProperties = {
    width: `${label.widthMm}mm`,
    height: `${label.heightMm}mm`,
    padding: compact ? '2mm 3mm' : '4mm',
  };

  return (
    <div
      className={`barcode-label flex shrink-0 flex-col items-center justify-center overflow-hidden rounded border border-dashed border-gray-300 bg-white text-center ${compact ? 'gap-1' : 'gap-2'}`}
      style={labelStyle}
      data-label-size={label.value}
    >
      <div className={`max-w-full truncate font-semibold text-gray-900 ${compact ? 'text-[10px] leading-tight' : 'text-sm'}`}>{item.itemName}</div>
      {type === 'QR_CODE' ? <QrSvg value={value} compact={compact} /> : <BarcodeSvg value={value} type={type} compact={compact} />}
      <div className={`font-semibold uppercase text-gray-500 ${compact ? 'text-[9px] leading-tight' : 'text-xs'}`}>Item ID: {value}</div>
    </div>
  );
};

export const GenerateBarcodePage: React.FC = () => {
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
            body { font-family: Arial, sans-serif; padding: 24px; }
            .barcode-print-grid {
              display: grid;
              grid-template-columns: repeat(auto-fit, minmax(${selectedLabel.widthMm}mm, ${selectedLabel.widthMm}mm));
              gap: 4mm;
              align-items: start;
            }
            .barcode-print-grid > div { break-inside: avoid; display: flex; justify-content: center; }
            .barcode-label {
              box-sizing: border-box;
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
            .barcode-label[data-label-size="100x50"] { gap: 2mm; }
            .barcode-label[data-label-size="100x25"],
            .barcode-label[data-label-size="50x25"] { gap: 1mm; }
            .barcode-label > div:first-child {
              max-width: 100%;
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
              font-weight: 600;
            }
            .barcode-label > div:last-child {
              font-weight: 600;
              color: #6b7280;
              text-transform: uppercase;
            }
            .barcode-label[data-label-size="100x50"] > div:first-child { font-size: 14px; }
            .barcode-label[data-label-size="100x50"] > div:last-child { font-size: 12px; }
            .barcode-label[data-label-size="100x25"] > div:first-child,
            .barcode-label[data-label-size="50x25"] > div:first-child { font-size: 10px; line-height: 1.1; }
            .barcode-label[data-label-size="100x25"] > div:last-child,
            .barcode-label[data-label-size="50x25"] > div:last-child { font-size: 9px; line-height: 1.1; }
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
                    <td className="border p-3">{selectedItem.barcode || 'N/A'}</td>
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
              <div ref={barcodeSectionRef} className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
              {Array.from({ length: generatedCount }).map((_, index) => (
                <div key={`${generatedItem.id}-${index}`} className="flex justify-center">
                  <BarcodePreview item={generatedItem} type={generatedType} label={selectedLabel} />
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
