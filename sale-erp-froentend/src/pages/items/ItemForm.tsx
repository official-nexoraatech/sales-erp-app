import React, { useEffect, useRef, useState } from 'react';
import { CirclePlus } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { brandApi, categoryApi, unitApi, warehouseApi } from '../../api/endpoints';
import type { ItemListItem, ItemRequest } from '../../api/endpoints';
import { Button } from '../../components/ui/Button';
import { NumericInput } from '../../components/ui/NumericInput';
import { WarehouseSelector } from './WarehouseSelector';

type ItemFormInitial = Partial<ItemListItem> & Partial<Omit<ItemRequest, keyof ItemListItem>>;
interface Props {
  initial?: ItemFormInitial;
  submitText: string;
  loading: boolean;
  validationErrors?: Record<string, string>;
  onFieldChange?: () => void;
  onSubmit: (payload: ItemRequest) => void;
  onCancel: () => void;
}
const inputClass = 'h-10 w-full rounded border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-gray-50';
const today = new Date().toISOString().slice(0, 10);
const numberValue = (value: unknown) => Number(value || 0);
const buildFormState = (initial?: ItemFormInitial): ItemRequest => ({
  itemName: initial?.itemName || '',
  itemCode: initial?.itemCode || initial?.batchNo || '',
  sku: initial?.sku || '',
  hsnCode: initial?.hsnCode || '',
  categoryId: numberValue(initial?.categoryId),
  subCategoryId: numberValue(initial?.subCategoryId),
  brandId: numberValue(initial?.brandId),
  baseUnitId: numberValue(initial?.baseUnitId),
  purchasePrice: numberValue(initial?.purchasePrice),
  purchasePriceWithTax: numberValue(initial?.purchasePriceWithTax),
  taxPercentage: numberValue(initial?.taxPercentage),
  salePrice: numberValue(initial?.salePrice),
  wholesalePrice: numberValue(initial?.wholesalePrice),
  mrp: numberValue(initial?.mrp),
  msp: numberValue(initial?.msp),
  discountPercentage: numberValue(initial?.discountPercentage),
  profitMargin: numberValue(initial?.profitMargin),
  batchNo: initial?.batchNo || initial?.itemCode || '',
  manufacturingDate: initial?.manufacturingDate || today,
  expiryDate: initial?.expiryDate || today,
  openingQuantity: numberValue(initial?.openingQuantity ?? initial?.availableQty),
  minimumStock: numberValue(initial?.minimumStock),
  warehouseId: numberValue(initial?.warehouseId),
  description: initial?.description || '',
});

export const ItemForm: React.FC<Props> = ({
  initial,
  submitText,
  loading,
  validationErrors = {},
  onFieldChange,
  onSubmit,
  onCancel,
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const [activeTab, setActiveTab] = useState<'pricing' | 'stock'>('pricing');
  const [imagePreviewUrl, setImagePreviewUrl] = useState('');
  const [imageName, setImageName] = useState('');
  const [form, setForm] = useState<ItemRequest>(() => buildFormState(initial));
  const categories = useQuery({ queryKey: ['item-form-categories'], queryFn: () => categoryApi.getAll({ page: 0, size: 100, search: '' }) });
  const brands = useQuery({
    queryKey: ['item-form-brands', form.categoryId],
    queryFn: () => brandApi.getByCategoryId(form.categoryId),
    enabled: form.categoryId > 0,
  });
  const warehouses = useQuery({ queryKey: ['item-form-warehouses'], queryFn: () => warehouseApi.getAll() });
  const units = useQuery({ queryKey: ['item-form-units'], queryFn: () => unitApi.getAll({ page: 0, size: 100, search: '' }) });
  const warehouseRows = warehouses.data?.data || [];
  const fieldError = (field: keyof ItemRequest, aliases: string[] = []) =>
    validationErrors[field] || aliases.map((alias) => validationErrors[alias]).find(Boolean);
  const controlClass = (field: keyof ItemRequest, baseClass = inputClass, aliases: string[] = []) =>
    `${baseClass} ${fieldError(field, aliases) ? 'border-red-400 focus:border-red-400 focus:ring-red-100' : ''}`;
  const renderFieldError = (field: keyof ItemRequest, aliases: string[] = []) => {
    const message = fieldError(field, aliases);
    return message ? <p className="mt-1 text-xs font-medium text-red-600">{message}</p> : null;
  };
  const set = (field: keyof ItemRequest, value: string | number) => {
    onFieldChange?.();
    setForm((current) => ({ ...current, [field]: value }));
  };
  const setBatchNo = (batchNo: string) => {
    onFieldChange?.();
    setForm((current) => ({ ...current, batchNo, itemCode: batchNo }));
  };
  const setCategory = (categoryId: number) => {
    onFieldChange?.();
    setForm((current) => ({ ...current, categoryId, brandId: 0 }));
  };
  const unitRows = units.data?.data?.content || [];
  useEffect(() => {
    setForm(buildFormState(initial));
  }, [initial?.id]);
  useEffect(() => {
    const errorFields = Object.keys(validationErrors);
    const pricingFields = ['purchasePrice', 'purchasePriceWithTax', 'taxPercentage', 'profitMargin', 'mrp', 'wholesalePrice', 'discountPercentage', 'salePrice', 'msp'];
    const stockFields = ['warehouseId', 'manufacturingDate', 'openingQuantity', 'minimumStock', 'expiryDate'];
    if (errorFields.some((field) => pricingFields.includes(field))) setActiveTab('pricing');
    else if (errorFields.some((field) => stockFields.includes(field))) setActiveTab('stock');
  }, [validationErrors]);
  useEffect(() => () => {
    if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
  }, [imagePreviewUrl]);
  useEffect(() => {
    if (!form.warehouseId && warehouseRows.length) {
      set('warehouseId', warehouseRows[0].id);
    }
  }, [form.warehouseId, warehouseRows]);
  const submit = () => {
    if (!form.itemName.trim()) return toast.error('Item name is required.');
    if (!form.batchNo.trim()) return toast.error('Batch number is required.');
    if (!Number.isInteger(form.openingQuantity) || form.openingQuantity <= 0) return toast.error('Opening quantity must be a positive whole number.');
    if (!form.categoryId) return toast.error('Category is required.');
    if (!form.brandId) return toast.error('Brand is required.');
    onSubmit(form);
  };
  const chooseImage = (file?: File | null) => {
    if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    if (!file) {
      setImagePreviewUrl('');
      setImageName('');
      if (imageInputRef.current) imageInputRef.current.value = '';
      return;
    }
    if (!file.type.startsWith('image/')) {
      toast.error('Please choose an image file.');
      return;
    }
    if (file.size > 1024 * 1024) {
      toast.error('Image size must be 1MB or less.');
      return;
    }
    setImagePreviewUrl(URL.createObjectURL(file));
    setImageName(file.name);
  };
  const createWarehouse = () => {
    const returnTo = `${location.pathname}${location.search}`;
    navigate(`/warehouses/create?returnTo=${encodeURIComponent(returnTo)}`);
  };
  const createCategory = () => {
    const returnTo = `${location.pathname}${location.search}`;
    navigate(`/items/categories/create?returnTo=${encodeURIComponent(returnTo)}`);
  };
  const createBrand = () => {
    const returnTo = `${location.pathname}${location.search}`;
    navigate(`/items/brands/create?returnTo=${encodeURIComponent(returnTo)}`);
  };

  return (
    <div className="overflow-hidden rounded-lg bg-white shadow">
      <div className="flex items-center justify-between border-b px-5 py-4"><h1 className="text-xl font-semibold text-gray-900">Item Details</h1></div>
      <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-3">
        <label className="text-sm text-gray-600">Name
          <input className={`${controlClass('itemName')} mt-1`} value={form.itemName} onChange={(event) => set('itemName', event.target.value)} />
          {renderFieldError('itemName')}
        </label>
        <label className="text-sm text-gray-600">HSN
          <input className={`${controlClass('hsnCode')} mt-1`} value={form.hsnCode} onChange={(event) => set('hsnCode', event.target.value)} />
          {renderFieldError('hsnCode')}
        </label>
        <label className="text-sm text-gray-600">SKU
          <input className={`${controlClass('sku')} mt-1`} value={form.sku} onChange={(event) => set('sku', event.target.value)} />
          {renderFieldError('sku')}
        </label>
        <label className="text-sm text-gray-600">Batch No
          <input className={`${controlClass('batchNo', inputClass, ['itemCode'])} mt-1`} value={form.batchNo} onChange={(event) => setBatchNo(event.target.value)} />
          {renderFieldError('batchNo', ['itemCode'])}
        </label>
        <label className="text-sm text-gray-600">Category
          <div className="mt-1 flex">
            <select className={`${controlClass('categoryId')} rounded-r-none`} value={form.categoryId} disabled={categories.isLoading} onChange={(event) => setCategory(Number(event.target.value))}>
              <option value={0}>{categories.isLoading ? 'Loading categories...' : 'Select category'}</option>
              {(categories.data?.data?.content || []).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
            <button type="button" title="Create category" aria-label="Create category" onClick={createCategory} className="flex h-10 w-10 items-center justify-center rounded-r border border-l-0 border-blue-400 text-blue-500 hover:bg-blue-50"><CirclePlus size={17} /></button>
          </div>
          {renderFieldError('categoryId')}
        </label>
        <label className="text-sm text-gray-600">Brand
          <div className="mt-1 flex">
            <select className={`${controlClass('brandId')} rounded-r-none`} value={form.brandId} disabled={!form.categoryId || brands.isLoading} onChange={(event) => set('brandId', Number(event.target.value))}>
              <option value={0}>{!form.categoryId ? 'Select category first' : brands.isLoading ? 'Loading brands...' : 'Select brand'}</option>
              {(brands.data?.data?.content || []).map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
            </select>
            <button type="button" title="Create brand" aria-label="Create brand" onClick={createBrand} className="flex h-10 w-10 items-center justify-center rounded-r border border-l-0 border-blue-400 text-blue-500 hover:bg-blue-50"><CirclePlus size={17} /></button>
          </div>
          {renderFieldError('brandId')}
        </label>
        <label className="text-sm text-gray-600">Opening Quantity
          <NumericInput integer min={1} className={`${controlClass('openingQuantity')} mt-1`} value={form.openingQuantity || ''} onValueChange={(value) => set('openingQuantity', Math.trunc(value))} />
          {renderFieldError('openingQuantity')}
        </label>
        <label className="text-sm text-gray-600">Description
          <textarea className={`${controlClass('description', 'h-24 w-full resize-none rounded border border-gray-300 p-3 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100')} mt-1`} value={form.description} onChange={(event) => set('description', event.target.value)} />
          {renderFieldError('description')}
        </label>
        <label className="text-sm text-gray-600">Base Unit
          <select className={`${controlClass('baseUnitId')} mt-1`} value={form.baseUnitId} disabled={units.isLoading} onChange={(event) => set('baseUnitId', Number(event.target.value))}>
            <option value={0}>{units.isLoading ? 'Loading units...' : 'Select unit'}</option>
            {unitRows.map((unit) => <option key={unit.id} value={unit.id}>{unit.name} ({unit.shortName})</option>)}
          </select>
          {renderFieldError('baseUnitId')}
        </label>
        <div className="text-sm text-gray-600">
          <span>Upload Image</span>
          <div className="mt-1 flex min-h-24 items-center gap-4 rounded border border-gray-200 bg-gray-50 p-3">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded border border-dashed border-gray-300 bg-white text-center text-[10px] text-gray-400">
              {imagePreviewUrl ? <img src={imagePreviewUrl} alt={imageName} className="h-full w-full object-cover" /> : <>NO IMAGE<br />FOUND</>}
            </div>
            <div>
              <input ref={imageInputRef} type="file" accept="image/png,image/jpeg,image/gif" className="hidden" onChange={(event) => chooseImage(event.target.files?.[0])} />
              <button type="button" onClick={() => imageInputRef.current?.click()} className="rounded border border-blue-400 bg-white px-4 py-2 text-blue-600 hover:bg-blue-50">Browse</button>
              <button type="button" onClick={() => chooseImage(null)} className="ml-2 rounded border border-gray-300 bg-white px-4 py-2 text-gray-600 hover:bg-gray-100">Reset</button>
              <p className="mt-2 text-xs leading-5 text-gray-500">{imageName || 'Allowed JPG, GIF or PNG.'}<br />Max size of 1MB</p>
            </div>
          </div>
        </div>
      </div>
      <div className="border-t px-5 py-4"><label className="inline-flex items-center gap-2 text-sm font-semibold"><input type="radio" defaultChecked />Regular</label></div>
      <div className="px-5 pt-3"><button onClick={() => setActiveTab('pricing')} className={`rounded-t border px-4 py-2 text-sm ${activeTab === 'pricing' ? 'border-green-500 text-green-600' : 'text-blue-600'}`}>$ Pricing</button><button onClick={() => setActiveTab('stock')} className={`rounded-t border px-4 py-2 text-sm ${activeTab === 'stock' ? 'border-green-500 text-green-600' : 'text-blue-600'}`}>▣ Stock</button></div>
      {activeTab === 'pricing' ? <div className="grid grid-cols-1 gap-4 border-t p-5 md:grid-cols-3">
        <label className="text-sm text-gray-600">Purchase Price<div className="mt-1 flex"><NumericInput min={0} className={`${controlClass('purchasePrice')} rounded-r-none bg-green-50`} value={form.purchasePrice || ''} onValueChange={(value) => set('purchasePrice', value)} /><select className="h-10 rounded-r border border-l-0 px-3"><option>With Tax</option></select></div>{renderFieldError('purchasePrice')}</label>
        <label className="text-sm text-gray-600">Tax<div className="mt-1 flex"><select className={`${controlClass('taxPercentage')} rounded-r-none`} value={form.taxPercentage} onChange={(event) => set('taxPercentage', Number(event.target.value))}><option value={0}>None</option><option value={5}>5%</option><option value={18}>18%</option></select><button type="button" className="flex h-10 w-10 items-center justify-center rounded-r border border-l-0 border-blue-400 text-blue-500"><CirclePlus size={17} /></button></div>{renderFieldError('taxPercentage')}</label>
        <label className="text-sm text-gray-600">Sale Profit Margin (%)<NumericInput min={0} className={`${controlClass('profitMargin')} mt-1 bg-green-50`} value={form.profitMargin || ''} onValueChange={(value) => set('profitMargin', value)} />{renderFieldError('profitMargin')}</label>
        <label className="text-sm text-gray-600">MRP<div className="mt-1 flex"><NumericInput min={0} className={`${controlClass('mrp')} rounded-r-none`} value={form.mrp || ''} onValueChange={(value) => set('mrp', value)} /><select className="h-10 rounded-r border border-l-0 px-3"><option>With Tax</option></select></div>{renderFieldError('mrp')}</label>
        <label className="text-sm text-gray-600">Wholesale Price<div className="mt-1 flex"><NumericInput min={0} className={`${controlClass('wholesalePrice')} rounded-r-none`} value={form.wholesalePrice || ''} onValueChange={(value) => set('wholesalePrice', value)} /><select className="h-10 rounded-r border border-l-0 px-3"><option>With Tax</option></select></div>{renderFieldError('wholesalePrice')}</label>
        <label className="text-sm text-gray-600">Discount on MRP<div className="mt-1 flex"><NumericInput min={0} className={`${controlClass('discountPercentage')} rounded-r-none`} value={form.discountPercentage || ''} onValueChange={(value) => set('discountPercentage', value)} /><select className="h-10 rounded-r border border-l-0 px-3"><option>Percentage</option></select></div>{renderFieldError('discountPercentage')}</label>
        <label className="text-sm text-gray-600">Sale Price<div className="mt-1 flex"><NumericInput min={0} className={`${controlClass('salePrice')} rounded-r-none bg-green-50`} value={form.salePrice || ''} onValueChange={(value) => set('salePrice', value)} /><select className="h-10 rounded-r border border-l-0 px-3"><option>With Tax</option></select></div>{renderFieldError('salePrice')}</label>
        <label className="text-sm text-gray-600">MSP<NumericInput min={0} className={`${controlClass('msp')} mt-1`} value={form.msp || ''} onValueChange={(value) => set('msp', value)} />{renderFieldError('msp')}</label>
      </div> : <div className="grid grid-cols-1 gap-4 border-t p-5 md:grid-cols-2">
        <div>
          <WarehouseSelector
            value={form.warehouseId}
            rows={warehouseRows}
            isLoading={warehouses.isLoading}
            hasError={Boolean(fieldError('warehouseId'))}
            onChange={(warehouseId) => set('warehouseId', warehouseId)}
            onCreate={createWarehouse}
          />
          {renderFieldError('warehouseId')}
        </div>
        <label className="text-sm text-gray-600">As of Date<input type="date" className={`${controlClass('manufacturingDate')} mt-1`} value={form.manufacturingDate} onChange={(event) => set('manufacturingDate', event.target.value)} />{renderFieldError('manufacturingDate')}</label>
        <label className="text-sm text-gray-600">Minimum Stock<NumericInput min={0} className={`${controlClass('minimumStock')} mt-1`} value={form.minimumStock || ''} onValueChange={(value) => set('minimumStock', value)} />{renderFieldError('minimumStock')}</label>
        <label className="text-sm text-gray-600">Exp.Date<input type="date" className={`${controlClass('expiryDate')} mt-1`} value={form.expiryDate} onChange={(event) => set('expiryDate', event.target.value)} />{renderFieldError('expiryDate')}</label>
      </div>}
      <div className="flex gap-3 border-t p-5"><Button onClick={submit} isLoading={loading}>{submitText}</Button><Button variant="secondary" onClick={onCancel}>Close</Button></div>
    </div>
  );
};
