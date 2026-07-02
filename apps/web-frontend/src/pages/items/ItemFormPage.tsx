import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { itemApi, categoryApi, brandApi, unitApi, gstApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPSwitch from '../../components/erp/ERPSwitch.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';
import Button from '../../components/ui/Button.js';

const HSN_RE = /^\d{4,8}$/;
const GST_RATES = [0, 5, 12, 18, 28];

interface FormData {
  name: string;
  itemCode?: string;
  hsnCode: string;
  gstRate: number;
  cessRate?: number;
  categoryId?: number;
  brandId?: number;
  unitId?: number;
  mrp?: number;
  salePrice?: number;
  minSalePrice?: number;
  purchasePrice?: number;
  reorderLevel?: number;
  barcode?: string;
  barcodeType?: string;
  trackInventory?: boolean;
  isFabricItem?: boolean;
  fabricWidth?: number;
  description?: string;
}

export default function ItemFormPage() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isEdit = !!id;
  const [hsnSuggestions, setHsnSuggestions] = useState<{ hsnCode: string; description: string }[]>([]);
  const [hsnSearch, setHsnSearch] = useState('');

  const { data: itemData } = useQuery({ queryKey: ['items', id], queryFn: () => itemApi.getById(Number(id)), enabled: isEdit });
  const { data: catData } = useQuery({ queryKey: ['categories'], queryFn: () => categoryApi.list() });
  const { data: brandData } = useQuery({ queryKey: ['brands'], queryFn: () => brandApi.list() });
  const { data: unitData } = useQuery({ queryKey: ['units'], queryFn: () => unitApi.list() });

  const item = (itemData as Record<string, unknown>)?.data as Record<string, unknown> | undefined;
  const categories = ((catData as Record<string, unknown>)?.data as Record<string, unknown[]>)?.content ?? [];
  const brands = ((brandData as Record<string, unknown>)?.data as Record<string, unknown[]>)?.content ?? [];
  const units = ((unitData as Record<string, unknown>)?.data as Record<string, unknown[]>)?.content ?? [];

  const { register, handleSubmit, reset, watch, setValue, formState: { errors, isSubmitting } } = useForm<FormData>({
    defaultValues: { gstRate: 5, trackInventory: true },
  });

  useEffect(() => {
    if (item) reset(item as unknown as FormData);
  }, [item, reset]);

  async function searchHsn(q: string) {
    if (q.length < 3) { setHsnSuggestions([]); return; }
    try {
      const res = await gstApi.searchHsn(q);
      setHsnSuggestions(((res as Record<string, unknown>)?.content ?? []) as { hsnCode: string; description: string }[]);
    } catch { setHsnSuggestions([]); }
  }

  const mutation = useMutation({
    mutationFn: (d: Record<string, unknown>) => isEdit ? itemApi.update(Number(id), d) : itemApi.create(d),
    onSuccess: () => {
      toast.success(isEdit ? 'Item updated' : 'Item created');
      qc.invalidateQueries({ queryKey: ['items'] });
      navigate('/inventory/items');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const isFabric = watch('isFabricItem');

  return (
    <div>
      <ERPPageHeader variant="list" title={isEdit ? 'Edit Item' : 'New Item'} subtitle="Add or edit item master details." />

      <form onSubmit={handleSubmit((d) => mutation.mutate(d as unknown as Record<string, unknown>))} className="max-w-3xl space-y-6">
        {/* Basic */}
        <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Basic Information</h2>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Item Name" required {...register('name', { required: 'Required' })} error={errors.name?.message} />
            <Input label="Item Code / SKU" {...register('itemCode')} hint="Auto-generated if blank" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Select label="Category" {...register('categoryId')}>
              <option value="">None</option>
              {(categories as Record<string, unknown>[]).map((c) => <option key={c.id as number} value={c.id as number}>{c.name as string}</option>)}
            </Select>
            <Select label="Brand" {...register('brandId')}>
              <option value="">None</option>
              {(brands as Record<string, unknown>[]).map((b) => <option key={b.id as number} value={b.id as number}>{b.name as string}</option>)}
            </Select>
          </div>
          <Select label="Unit of Measure" {...register('unitId')}>
            <option value="">Select unit…</option>
            {(units as Record<string, unknown>[]).map((u) => <option key={u.id as number} value={u.id as number}>{u.name as string} ({u.symbol as string})</option>)}
          </Select>
          <Input label="Description" {...register('description')} />
        </section>

        {/* GST/HSN */}
        <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">GST & HSN</h2>
          <div className="relative">
            <Input
              label="HSN Code"
              required
              placeholder="Search HSN…"
              {...register('hsnCode', {
                required: 'Required',
                pattern: { value: HSN_RE, message: '4–8 digits' },
              })}
              error={errors.hsnCode?.message}
              onChange={(e) => { setValue('hsnCode', e.target.value); searchHsn(e.target.value); setHsnSearch(e.target.value); }}
              value={hsnSearch || watch('hsnCode') || ''}
            />
            {hsnSuggestions.length > 0 && (
              <ul className="absolute z-10 mt-1 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg max-h-40 overflow-y-auto w-full text-sm">
                {hsnSuggestions.map((h) => (
                  <li key={h.hsnCode}>
                    <button
                      type="button"
                      className="w-full text-left px-3 py-2 hover:bg-indigo-50 dark:hover:bg-indigo-900/20"
                      onClick={() => { setValue('hsnCode', h.hsnCode); setHsnSearch(h.hsnCode); setHsnSuggestions([]); }}
                    >
                      <span className="font-mono font-bold">{h.hsnCode}</span> — {h.description}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Select label="GST Rate %" required {...register('gstRate', { required: 'Required', valueAsNumber: true })}>
              {GST_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}
            </Select>
            <Input label="Cess Rate %" type="number" step="0.01" {...register('cessRate')} />
          </div>
        </section>

        {/* Pricing */}
        <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Pricing</h2>
          <div className="grid grid-cols-2 gap-4">
            <Input label="MRP (₹)" type="number" step="0.01" {...register('mrp')} />
            <Input label="Sale Price (₹)" type="number" step="0.01" {...register('salePrice')} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Min Sale Price (₹)" type="number" step="0.01" {...register('minSalePrice')} />
            <Input label="Purchase Price (₹)" type="number" step="0.01" {...register('purchasePrice')} />
          </div>
        </section>

        {/* Inventory */}
        <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Inventory & Barcode</h2>
          <div className="flex items-center gap-6">
            <ERPSwitch
              label="Track Inventory"
              description="Deduct stock on sales"
              checked={!!watch('trackInventory')}
              onChange={(v) => setValue('trackInventory', v)}
            />
            <ERPSwitch
              label="Fabric Item"
              description="Enable fabric roll tracking"
              checked={!!watch('isFabricItem')}
              onChange={(v) => setValue('isFabricItem', v)}
            />
          </div>
          {isFabric && <Input label="Fabric Width (cm)" type="number" {...register('fabricWidth')} />}
          <Input label="Reorder Level" type="number" {...register('reorderLevel')} />
          <div className="grid grid-cols-2 gap-4">
            <Input label="Barcode" {...register('barcode')} />
            <Select label="Barcode Type" {...register('barcodeType')}>
              <option value="EAN13">EAN-13</option>
              <option value="CODE128">CODE-128</option>
              <option value="QR">QR Code</option>
              <option value="CUSTOM">Custom</option>
            </Select>
          </div>
        </section>

        <div className="flex gap-3">
          <Button type="submit" loading={isSubmitting || mutation.isPending}>{isEdit ? 'Update' : 'Create'} Item</Button>
          <Button variant="secondary" type="button" onClick={() => navigate('/inventory/items')}>Cancel</Button>
        </div>
      </form>
    </div>
  );
}
