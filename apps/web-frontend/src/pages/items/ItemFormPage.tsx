import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { itemApi, categoryApi, brandApi, unitApi, gstApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPSwitch from '../../components/erp/ERPSwitch.js';
import ERPFormSection from '../../components/erp/ERPFormSection.js';
import ERPStickyFooter from '../../components/erp/ERPStickyFooter.js';
import { ERPFormSkeleton } from '../../components/erp/ERPSkeleton.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';
import Button from '../../components/ui/Button.js';
import { itemFormSchema, GST_RATES, type ItemFormData } from '../../schemas/item.schema.js';

export default function ItemFormPage() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const isEdit = !!id;
  const [hsnSuggestions, setHsnSuggestions] = useState<{ hsnCode: string; description: string }[]>(
    []
  );
  const [hsnSearch, setHsnSearch] = useState('');

  const { data: itemData, isLoading: itemLoading } = useQuery({
    queryKey: ['items', id],
    queryFn: () => itemApi.getById(Number(id)),
    enabled: isEdit,
  });
  const { data: catData } = useQuery({
    queryKey: ['categories'],
    queryFn: () => categoryApi.list(),
    enabled: hasPermission(PERMISSIONS.CATEGORY_VIEW),
  });
  const { data: brandData } = useQuery({
    queryKey: ['brands'],
    queryFn: () => brandApi.list(),
    enabled: hasPermission(PERMISSIONS.BRAND_VIEW),
  });
  const { data: unitData } = useQuery({
    queryKey: ['units'],
    queryFn: () => unitApi.list(),
    enabled: hasPermission(PERMISSIONS.UNIT_VIEW),
  });

  const item = itemData as Record<string, unknown> | undefined;
  const categories = (catData as Record<string, unknown[]>)?.content ?? [];
  const brands = (brandData as Record<string, unknown[]>)?.content ?? [];
  const units = (unitData as Record<string, unknown[]>)?.content ?? [];

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<ItemFormData>({
    resolver: zodResolver(itemFormSchema),
    defaultValues: { gstRate: 5, trackInventory: true },
  });

  useEffect(() => {
    if (item) reset(item as unknown as ItemFormData);
  }, [item, reset]);

  async function searchHsn(q: string) {
    if (q.length < 3) {
      setHsnSuggestions([]);
      return;
    }
    try {
      const res = await gstApi.searchHsn(q);
      setHsnSuggestions(
        ((res as Record<string, unknown>)?.content ?? []) as {
          hsnCode: string;
          description: string;
        }[]
      );
    } catch {
      setHsnSuggestions([]);
    }
  }

  const mutation = useMutation({
    mutationFn: (d: Record<string, unknown>) =>
      isEdit ? itemApi.update(Number(id), d) : itemApi.create(d),
    onSuccess: () => {
      toast.success(isEdit ? 'Item updated' : 'Item created');
      qc.invalidateQueries({ queryKey: ['items'] });
      navigate('/inventory/items');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const isFabric = watch('isFabricItem');

  if (isEdit && itemLoading) {
    return (
      <div>
        <ERPPageHeader
          variant="detail"
          title="Edit Item"
          subtitle="Add or edit item master details."
          backTo="/inventory/items"
        />
        <ERPFormSkeleton />
      </div>
    );
  }

  return (
    <div>
      <ERPPageHeader
        variant="detail"
        title={isEdit ? 'Edit Item' : 'New Item'}
        subtitle="Add or edit item master details."
        backTo="/inventory/items"
      />

      <form
        onSubmit={handleSubmit((d) => mutation.mutate(d as unknown as Record<string, unknown>))}
        className="space-y-6"
        noValidate
      >
        <ERPFormSection title="Basic Information" columns={2}>
          <Input label="Item Name" required {...register('name')} error={errors.name?.message} />
          <Input
            label="Item Code / SKU"
            {...register('itemCode')}
            hint="Auto-generated if blank"
            error={errors.itemCode?.message}
          />
          <Select label="Category" {...register('categoryId')} error={errors.categoryId?.message}>
            <option value="">None</option>
            {(categories as Record<string, unknown>[]).map((c) => (
              <option key={c.id as number} value={c.id as number}>
                {c.name as string}
              </option>
            ))}
          </Select>
          <Select label="Brand" {...register('brandId')} error={errors.brandId?.message}>
            <option value="">None</option>
            {(brands as Record<string, unknown>[]).map((b) => (
              <option key={b.id as number} value={b.id as number}>
                {b.name as string}
              </option>
            ))}
          </Select>
          <Select
            label="Unit of Measure"
            required
            {...register('unitId')}
            error={errors.unitId?.message}
          >
            <option value="">Select unit…</option>
            {(units as Record<string, unknown>[]).map((u) => (
              <option key={u.id as number} value={u.id as number}>
                {u.name as string} ({u.abbreviation as string})
              </option>
            ))}
          </Select>
          <Input
            label="Description"
            wrapperClassName="sm:col-span-2"
            {...register('description')}
            error={errors.description?.message}
          />
        </ERPFormSection>

        <ERPFormSection title="GST & HSN" columns={2}>
          <div className="relative sm:col-span-2">
            <Input
              label="HSN Code"
              required
              placeholder="Search HSN…"
              {...register('hsnCode')}
              error={errors.hsnCode?.message}
              onChange={(e) => {
                setValue('hsnCode', e.target.value);
                searchHsn(e.target.value);
                setHsnSearch(e.target.value);
              }}
              value={hsnSearch || watch('hsnCode') || ''}
            />
            {hsnSuggestions.length > 0 && (
              <ul className="absolute z-10 mt-1 bg-surface-card border border-default rounded-lg shadow-token-lg max-h-40 overflow-y-auto w-full text-sm">
                {hsnSuggestions.map((h) => (
                  <li key={h.hsnCode}>
                    <button
                      type="button"
                      className="w-full text-left px-3 py-2 hover:bg-surface-raised"
                      onClick={() => {
                        setValue('hsnCode', h.hsnCode);
                        setHsnSearch(h.hsnCode);
                        setHsnSuggestions([]);
                      }}
                    >
                      <span className="font-mono font-bold">{h.hsnCode}</span> — {h.description}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Select
            label="GST Rate %"
            required
            {...register('gstRate', { valueAsNumber: true })}
            error={errors.gstRate?.message}
          >
            {GST_RATES.map((r) => (
              <option key={r} value={r}>
                {r}%
              </option>
            ))}
          </Select>
          <Input
            label="Cess Rate %"
            type="number"
            step="0.01"
            {...register('cessRate')}
            error={errors.cessRate?.message}
          />
        </ERPFormSection>

        <ERPFormSection title="Pricing" columns={2}>
          <Input
            label="MRP (₹)"
            type="number"
            step="0.01"
            {...register('mrp')}
            error={errors.mrp?.message}
          />
          <Input
            label="Sale Price (₹)"
            type="number"
            step="0.01"
            {...register('salePrice')}
            error={errors.salePrice?.message}
          />
          <Input
            label="Min Sale Price (₹)"
            type="number"
            step="0.01"
            {...register('minSalePrice')}
            error={errors.minSalePrice?.message}
          />
          <Input
            label="Purchase Price (₹)"
            type="number"
            step="0.01"
            {...register('purchasePrice')}
            error={errors.purchasePrice?.message}
          />
        </ERPFormSection>

        <ERPFormSection title="Inventory & Barcode" columns={2}>
          <div className="flex items-center gap-6 sm:col-span-2">
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
          {isFabric && (
            <Input
              label="Fabric Width (cm)"
              type="number"
              {...register('fabricWidth')}
              error={errors.fabricWidth?.message}
            />
          )}
          <Input
            label="Reorder Level"
            type="number"
            {...register('reorderLevel')}
            error={errors.reorderLevel?.message}
          />
          <Input label="Barcode" {...register('barcode')} error={errors.barcode?.message} />
          <Select label="Barcode Type" {...register('barcodeType')}>
            <option value="EAN13">EAN-13</option>
            <option value="CODE128">CODE-128</option>
            <option value="QR">QR Code</option>
            <option value="CUSTOM">Custom</option>
          </Select>
        </ERPFormSection>

        <ERPStickyFooter>
          <Button variant="secondary" type="button" onClick={() => navigate('/inventory/items')}>
            Cancel
          </Button>
          <Button type="submit" loading={isSubmitting || mutation.isPending}>
            {isEdit ? 'Update' : 'Create'} Item
          </Button>
        </ERPStickyFooter>
      </form>
    </div>
  );
}
