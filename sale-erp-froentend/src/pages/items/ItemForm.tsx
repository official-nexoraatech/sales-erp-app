import React, { useEffect, useState } from 'react';
import { CirclePlus } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { brandApi, categoryApi, unitApi, warehouseApi } from '../../api/endpoints';
import type { ItemListItem, ItemRequest } from '../../api/endpoints';
import { Button } from '../../components/ui/Button';

type ItemFormInitial = Partial<ItemListItem> & Partial<Omit<ItemRequest, keyof ItemListItem>>;
interface Props { initial?: ItemFormInitial; submitText: string; loading: boolean; onSubmit: (payload: ItemRequest) => void; onCancel: () => void }
const inputClass = 'h-10 w-full rounded border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-gray-50';
const today = new Date().toISOString().slice(0, 10);
const numberValue = (value: unknown) => Number(value || 0);

export const ItemForm: React.FC<Props> = ({ initial, submitText, loading, onSubmit, onCancel }) => {
  const [activeTab, setActiveTab] = useState<'pricing' | 'stock'>('pricing');
  const [itemType, setItemType] = useState('Product');
  const [form, setForm] = useState<ItemRequest>({
    itemName: initial?.itemName || '', itemCode: initial?.itemCode || '', sku: initial?.sku || '', barcode: initial?.barcode || '', hsnCode: initial?.hsnCode || '',
    categoryId: numberValue(initial?.categoryId), subCategoryId: numberValue(initial?.subCategoryId), brandId: numberValue(initial?.brandId), baseUnitId: numberValue(initial?.baseUnitId), secondaryUnitId: numberValue(initial?.secondaryUnitId), conversionRate: numberValue(initial?.conversionRate) || 1,
    purchasePrice: numberValue(initial?.purchasePrice), purchasePriceWithTax: numberValue(initial?.purchasePriceWithTax), taxPercentage: numberValue(initial?.taxPercentage), salePrice: numberValue(initial?.salePrice), wholesalePrice: numberValue(initial?.wholesalePrice), mrp: numberValue(initial?.mrp), msp: numberValue(initial?.msp), discountPercentage: numberValue(initial?.discountPercentage), profitMargin: numberValue(initial?.profitMargin),
    batchNo: initial?.batchNo || '', manufacturingDate: initial?.manufacturingDate || today, expiryDate: initial?.expiryDate || today, openingQuantity: numberValue(initial?.openingQuantity), minimumStock: numberValue(initial?.minimumStock), warehouseId: numberValue(initial?.warehouseId), description: initial?.description || '',
  });
  const categories = useQuery({ queryKey: ['item-form-categories'], queryFn: () => categoryApi.getAll({ page: 0, size: 100, search: '' }) });
  const brands = useQuery({
    queryKey: ['item-form-brands', form.categoryId],
    queryFn: () => brandApi.getAll({ page: 0, size: 100, search: '', categoryId: form.categoryId }),
    enabled: form.categoryId > 0,
  });
  const warehouses = useQuery({ queryKey: ['item-form-warehouses'], queryFn: () => warehouseApi.getAll() });
  const units = useQuery({ queryKey: ['item-form-units'], queryFn: () => unitApi.getAll({ page: 0, size: 100, search: '' }) });
  const warehouseRows = warehouses.data?.data || [];
  const set = (field: keyof ItemRequest, value: string | number) => setForm((current) => ({ ...current, [field]: value }));
  const setCategory = (categoryId: number) => setForm((current) => ({ ...current, categoryId, brandId: 0 }));
  const unitRows = units.data?.data?.content || [];
  const baseUnit = unitRows.find((unit) => unit.id === form.baseUnitId);
  const secondaryUnit = unitRows.find((unit) => unit.id === form.secondaryUnitId);
  useEffect(() => {
    if (!form.warehouseId && warehouseRows.length) {
      set('warehouseId', warehouseRows[0].id);
    }
  }, [form.warehouseId, warehouseRows]);
  const submit = () => {
    if (!form.itemName.trim()) return alert('Item name is required.');
    if (!form.categoryId) return alert('Category is required.');
    if (!form.brandId) return alert('Brand is required.');
    onSubmit(form);
  };

  return (
    <div className="overflow-hidden rounded-lg bg-white shadow">
      <div className="flex items-center justify-between border-b px-5 py-4"><h1 className="text-xl font-semibold text-gray-900">Item Details</h1><div className="overflow-hidden rounded border border-blue-500"><button onClick={() => setItemType('Product')} className={`px-4 py-2 text-sm ${itemType === 'Product' ? 'bg-blue-600 text-white' : 'text-blue-600'}`}>Product</button><button onClick={() => setItemType('Service')} className={`px-4 py-2 text-sm ${itemType === 'Service' ? 'bg-blue-600 text-white' : 'text-blue-600'}`}>Service</button></div></div>
      <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-3">
        <label className="text-sm text-gray-600">Name<input className={`${inputClass} mt-1`} value={form.itemName} onChange={(event) => set('itemName', event.target.value)} /></label>
        <label className="text-sm text-gray-600">HSN<input className={`${inputClass} mt-1`} value={form.hsnCode} onChange={(event) => set('hsnCode', event.target.value)} /></label>
        <label className="text-sm text-gray-600">SKU<input className={`${inputClass} mt-1`} value={form.sku} onChange={(event) => set('sku', event.target.value)} /></label>
        <label className="text-sm text-gray-600">Category<div className="mt-1 flex"><select className={`${inputClass} rounded-r-none`} value={form.categoryId} disabled={categories.isLoading} onChange={(event) => setCategory(Number(event.target.value))}><option value={0}>{categories.isLoading ? 'Loading categories...' : 'Select category'}</option>{(categories.data?.data?.content || []).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select><button type="button" className="flex h-10 w-10 items-center justify-center rounded-r border border-l-0 border-blue-400 text-blue-500"><CirclePlus size={17} /></button></div></label>
        <label className="text-sm text-gray-600">Item Code<div className="mt-1 flex"><input className={`${inputClass} rounded-r-none`} value={form.itemCode} onChange={(event) => set('itemCode', event.target.value)} /><button type="button" onClick={() => set('itemCode', String(Date.now()).slice(-10))} className="h-10 rounded-r border border-l-0 px-4 text-gray-600">Auto</button></div></label>
        <label className="text-sm text-gray-600">Brand<div className="mt-1 flex"><select className={`${inputClass} rounded-r-none`} value={form.brandId} disabled={!form.categoryId || brands.isLoading} onChange={(event) => set('brandId', Number(event.target.value))}><option value={0}>{!form.categoryId ? 'Select category first' : brands.isLoading ? 'Loading brands...' : 'Select brand'}</option>{(brands.data?.data?.content || []).map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</select><button type="button" className="flex h-10 w-10 items-center justify-center rounded-r border border-l-0 border-blue-400 text-blue-500"><CirclePlus size={17} /></button></div></label>
        <label className="text-sm text-gray-600">Description<textarea className="mt-1 h-16 w-full rounded border border-gray-300 p-3" value={form.description} onChange={(event) => set('description', event.target.value)} /></label>
        <div className="text-sm text-gray-600">
          <div className="grid grid-cols-2 gap-2">
            <label>Base Unit<select className={`${inputClass} mt-1`} value={form.baseUnitId} disabled={units.isLoading} onChange={(event) => set('baseUnitId', Number(event.target.value))}><option value={0}>{units.isLoading ? 'Loading units...' : 'Select unit'}</option>{unitRows.map((unit) => <option key={unit.id} value={unit.id}>{unit.name} ({unit.shortName})</option>)}</select></label>
            <label>Secondary Unit<select className={`${inputClass} mt-1`} value={form.secondaryUnitId} disabled={units.isLoading} onChange={(event) => set('secondaryUnitId', Number(event.target.value))}><option value={0}>{units.isLoading ? 'Loading units...' : 'Select unit'}</option>{unitRows.map((unit) => <option key={unit.id} value={unit.id}>{unit.name} ({unit.shortName})</option>)}</select></label>
          </div>
          <p className="mt-2 text-center">1 {baseUnit ? `${baseUnit.name}(${baseUnit.shortName})` : 'None(None)'} = {form.conversionRate || 1} {secondaryUnit ? `${secondaryUnit.name}(${secondaryUnit.shortName})` : 'None(None)'}</p>
        </div>
        <div className="text-sm text-gray-600"><div className="mt-1 flex items-center gap-4"><div className="flex h-24 w-24 items-center justify-center rounded border bg-gray-50 text-center text-xs text-gray-400">NO IMAGE<br />FOUND</div><div><button className="rounded border border-blue-400 px-4 py-2 text-blue-600">Browse</button><button className="ml-2 rounded border px-4 py-2">Reset</button><p className="mt-2 text-xs">Allowed JPG, GIF or PNG.<br />Max size of 1MB</p></div></div></div>
      </div>
      <div className="border-t px-5 py-4"><label className="inline-flex items-center gap-2 text-sm font-semibold"><input type="radio" defaultChecked />Regular</label></div>
      <div className="px-5 pt-3"><button onClick={() => setActiveTab('pricing')} className={`rounded-t border px-4 py-2 text-sm ${activeTab === 'pricing' ? 'border-green-500 text-green-600' : 'text-blue-600'}`}>$ Pricing</button><button onClick={() => setActiveTab('stock')} className={`rounded-t border px-4 py-2 text-sm ${activeTab === 'stock' ? 'border-green-500 text-green-600' : 'text-blue-600'}`}>▣ Stock</button></div>
      {activeTab === 'pricing' ? <div className="grid grid-cols-1 gap-4 border-t p-5 md:grid-cols-3">
        <label className="text-sm text-gray-600">Purchase Price<div className="mt-1 flex"><input type="number" className={`${inputClass} rounded-r-none bg-green-50`} value={form.purchasePrice || ''} onChange={(event) => set('purchasePrice', Number(event.target.value))} /><select className="h-10 rounded-r border border-l-0 px-3"><option>With Tax</option></select></div></label>
        <label className="text-sm text-gray-600">Tax<div className="mt-1 flex"><select className={`${inputClass} rounded-r-none`} value={form.taxPercentage} onChange={(event) => set('taxPercentage', Number(event.target.value))}><option value={0}>None</option><option value={5}>5%</option><option value={18}>18%</option></select><button className="flex h-10 w-10 items-center justify-center rounded-r border border-l-0 border-blue-400 text-blue-500"><CirclePlus size={17} /></button></div></label>
        <label className="text-sm text-gray-600">Sale Profit Margin (%)<input type="number" className={`${inputClass} mt-1 bg-green-50`} value={form.profitMargin || ''} onChange={(event) => set('profitMargin', Number(event.target.value))} /></label>
        <label className="text-sm text-gray-600">MRP<div className="mt-1 flex"><input type="number" className={`${inputClass} rounded-r-none`} value={form.mrp || ''} onChange={(event) => set('mrp', Number(event.target.value))} /><select className="h-10 rounded-r border border-l-0 px-3"><option>With Tax</option></select></div></label>
        <label className="text-sm text-gray-600">Wholesale Price<div className="mt-1 flex"><input type="number" className={`${inputClass} rounded-r-none`} value={form.wholesalePrice || ''} onChange={(event) => set('wholesalePrice', Number(event.target.value))} /><select className="h-10 rounded-r border border-l-0 px-3"><option>With Tax</option></select></div></label>
        <label className="text-sm text-gray-600">Discount on MRP<div className="mt-1 flex"><input type="number" className={`${inputClass} rounded-r-none`} value={form.discountPercentage || ''} onChange={(event) => set('discountPercentage', Number(event.target.value))} /><select className="h-10 rounded-r border border-l-0 px-3"><option>Percentage</option></select></div></label>
        <label className="text-sm text-gray-600">Sale Price<div className="mt-1 flex"><input type="number" className={`${inputClass} rounded-r-none bg-green-50`} value={form.salePrice || ''} onChange={(event) => set('salePrice', Number(event.target.value))} /><select className="h-10 rounded-r border border-l-0 px-3"><option>With Tax</option></select></div></label>
        <label className="text-sm text-gray-600">MSP<input type="number" className={`${inputClass} mt-1`} value={form.msp || ''} onChange={(event) => set('msp', Number(event.target.value))} /></label>
      </div> : <div className="grid grid-cols-1 gap-4 border-t p-5 md:grid-cols-2">
        <label className="text-sm text-gray-600">Warehouse<select className={`${inputClass} mt-1`} value={form.warehouseId} onChange={(event) => set('warehouseId', Number(event.target.value))}>{warehouseRows.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label>
        <label className="text-sm text-gray-600">As of Date<input type="date" className={`${inputClass} mt-1`} value={form.manufacturingDate} onChange={(event) => set('manufacturingDate', event.target.value)} /></label>
        <label className="text-sm text-gray-600">Opening Quantity<input type="number" className={`${inputClass} mt-1`} value={form.openingQuantity || ''} onChange={(event) => set('openingQuantity', Number(event.target.value))} /></label>
        <label className="text-sm text-gray-600">Item Location<input className={`${inputClass} mt-1`} value={form.barcode} onChange={(event) => set('barcode', event.target.value)} /></label>
        <label className="text-sm text-gray-600">Minimum Stock<input type="number" className={`${inputClass} mt-1`} value={form.minimumStock || ''} onChange={(event) => set('minimumStock', Number(event.target.value))} /></label>
        <label className="text-sm text-gray-600">Batch<input className={`${inputClass} mt-1`} value={form.batchNo} onChange={(event) => set('batchNo', event.target.value)} /></label>
        <label className="text-sm text-gray-600">Exp.Date<input type="date" className={`${inputClass} mt-1`} value={form.expiryDate} onChange={(event) => set('expiryDate', event.target.value)} /></label>
      </div>}
      <div className="flex gap-3 border-t p-5"><Button onClick={submit} isLoading={loading}>{submitText}</Button><Button variant="secondary" onClick={onCancel}>Close</Button></div>
    </div>
  );
};
