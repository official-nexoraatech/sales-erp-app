import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, useFieldArray } from 'react-hook-form';
import toast from 'react-hot-toast';
import { openingBalancesApi, customerApi, supplierApi, accountApi, warehouseApi, itemApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import Button from '../../components/ui/Button.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';
import Badge from '../../components/ui/Badge.js';
import { formatDate, formatDatetime, formatCurrency } from '../../lib/format.js';

const STEPS = [
  { id: 'customers', label: 'Customer Balances' },
  { id: 'suppliers', label: 'Supplier Balances' },
  { id: 'stock', label: 'Stock Quantities' },
  { id: 'accounts', label: 'Account Balances' },
  { id: 'cashbank', label: 'Cash & Bank' },
];

interface WizardStatus {
  status: string;
  customersComplete: boolean;
  suppliersComplete: boolean;
  stockComplete: boolean;
  accountsComplete: boolean;
  cashBankComplete: boolean;
  lockedAt?: string;
}

// ── Step: Customer Balances ──────────────────────────────────────────────────
function CustomerBalancesStep({ onSaved }: { onSaved: () => void }) {
  const { data: custData } = useQuery({ queryKey: ['customers'], queryFn: () => customerApi.list({ size: 200 }) });
  const customers = ((custData as Record<string, unknown>)?.data as Record<string, unknown>)?.content as Record<string, unknown>[] ?? [];

  const { control, register, handleSubmit } = useForm<{ rows: { customerId: number; amount: number; balanceType: string }[] }>({
    defaultValues: { rows: customers.map((c) => ({ customerId: c.id as number, amount: Number(c.openingBalance ?? 0), balanceType: 'DEBIT' })) },
  });
  const { fields } = useFieldArray({ control, name: 'rows' });

  const mutation = useMutation({
    mutationFn: (d: { rows: unknown[] }) => openingBalancesApi.saveCustomers(d.rows),
    onSuccess: () => { toast.success('Customer balances saved'); onSaved(); },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="space-y-4">
      <div className="max-h-80 overflow-y-auto space-y-2">
        {fields.map((field, i) => {
          const cust = customers.find((c) => c.id === field.customerId);
          return (
            <div key={field.id} className="flex items-center gap-3">
              <span className="text-sm text-gray-700 dark:text-gray-300 w-48 truncate">{cust?.displayName as string ?? field.customerId}</span>
              <Input type="number" step="0.01" {...register(`rows.${i}.amount`)} className="w-36" />
              <Select {...register(`rows.${i}.balanceType`)} className="w-28">
                <option value="DEBIT">Debit (Dr)</option>
                <option value="CREDIT">Credit (Cr)</option>
              </Select>
            </div>
          );
        })}
        {fields.length === 0 && <p className="text-sm text-gray-400">No customers. Add customers first.</p>}
      </div>
      <Button type="submit" loading={mutation.isPending}>Save & Next</Button>
    </form>
  );
}

// ── Step: Supplier Balances ──────────────────────────────────────────────────
function SupplierBalancesStep({ onSaved }: { onSaved: () => void }) {
  const { data: suppData } = useQuery({ queryKey: ['suppliers'], queryFn: () => supplierApi.list({ size: 200 }) });
  const suppliers = ((suppData as Record<string, unknown>)?.data as Record<string, unknown>)?.content as Record<string, unknown>[] ?? [];

  const { control, register, handleSubmit } = useForm<{ rows: { supplierId: number; amount: number; balanceType: string }[] }>({
    defaultValues: { rows: suppliers.map((s) => ({ supplierId: s.id as number, amount: Number(s.openingBalance ?? 0), balanceType: 'CREDIT' })) },
  });
  const { fields } = useFieldArray({ control, name: 'rows' });

  const mutation = useMutation({
    mutationFn: (d: { rows: unknown[] }) => openingBalancesApi.saveSuppliers(d.rows),
    onSuccess: () => { toast.success('Supplier balances saved'); onSaved(); },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="space-y-4">
      <div className="max-h-80 overflow-y-auto space-y-2">
        {fields.map((field, i) => {
          const supp = suppliers.find((s) => s.id === field.supplierId);
          return (
            <div key={field.id} className="flex items-center gap-3">
              <span className="text-sm text-gray-700 dark:text-gray-300 w-48 truncate">{supp?.displayName as string ?? field.supplierId}</span>
              <Input type="number" step="0.01" {...register(`rows.${i}.amount`)} className="w-36" />
              <Select {...register(`rows.${i}.balanceType`)} className="w-28">
                <option value="CREDIT">Credit (Cr)</option>
                <option value="DEBIT">Debit (Dr)</option>
              </Select>
            </div>
          );
        })}
        {fields.length === 0 && <p className="text-sm text-gray-400">No suppliers. Add suppliers first.</p>}
      </div>
      <Button type="submit" loading={mutation.isPending}>Save & Next</Button>
    </form>
  );
}

// ── Step: Stock ──────────────────────────────────────────────────────────────
function StockStep({ onSaved }: { onSaved: () => void }) {
  const { data: itemData } = useQuery({ queryKey: ['items'], queryFn: () => itemApi.list({ size: 200 }) });
  const { data: whData } = useQuery({ queryKey: ['warehouses'], queryFn: () => warehouseApi.list() });
  const items = ((itemData as Record<string, unknown>)?.data as Record<string, unknown>)?.content as Record<string, unknown>[] ?? [];
  const warehouses = ((whData as Record<string, unknown>)?.data as Record<string, unknown[]>)?.content ?? [];
  const defaultWh = (warehouses as Record<string, unknown>[]).find((w) => w.isDefault) ?? warehouses[0];

  const { control, register, handleSubmit } = useForm<{ rows: { itemId: number; quantity: number; unitCost: number; warehouseId: number }[] }>({
    defaultValues: { rows: items.filter((i) => i.trackInventory).map((i) => ({ itemId: i.id as number, quantity: 0, unitCost: Number(i.purchasePrice ?? 0), warehouseId: (defaultWh as Record<string, unknown>)?.id as number })) },
  });
  const { fields } = useFieldArray({ control, name: 'rows' });

  const mutation = useMutation({
    mutationFn: (d: { rows: unknown[] }) => openingBalancesApi.saveStock(d.rows),
    onSuccess: () => { toast.success('Stock opening balances saved'); onSaved(); },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="space-y-4">
      {fields.length === 0 && <p className="text-sm text-gray-400">No tracked items found.</p>}
      <div className="max-h-80 overflow-y-auto space-y-2">
        {fields.map((field, i) => {
          const item = items.find((it) => it.id === field.itemId);
          return (
            <div key={field.id} className="flex items-center gap-3">
              <span className="text-sm text-gray-700 dark:text-gray-300 w-40 truncate">{item?.name as string ?? field.itemId}</span>
              <Input type="number" step="0.001" placeholder="Qty" {...register(`rows.${i}.quantity`)} className="w-24" />
              <Input type="number" step="0.01" placeholder="Cost/unit" {...register(`rows.${i}.unitCost`)} className="w-28" />
              <Select {...register(`rows.${i}.warehouseId`)} className="w-32">
                {(warehouses as Record<string, unknown>[]).map((w) => <option key={w.id as number} value={w.id as number}>{w.name as string}</option>)}
              </Select>
            </div>
          );
        })}
      </div>
      <Button type="submit" loading={mutation.isPending}>Save & Next</Button>
    </form>
  );
}

// ── Step: Account Balances ───────────────────────────────────────────────────
function AccountBalancesStep({ onSaved }: { onSaved: () => void }) {
  const { data: accData } = useQuery({ queryKey: ['accounts'], queryFn: () => accountApi.list() });
  const accounts = ((accData as Record<string, unknown>)?.data as Record<string, unknown[]>)?.content ?? [];
  const leafAccounts = (accounts as Record<string, unknown>[]).filter((a) => !a.isSystem && !a.isCash && !a.isBank);

  const { control, register, handleSubmit } = useForm<{ rows: { accountId: number; amount: number; balanceType: string }[] }>({
    defaultValues: { rows: leafAccounts.map((a) => ({ accountId: a.id as number, amount: Number(a.openingBalance ?? 0), balanceType: (a.normalBalance as string) === 'DEBIT' ? 'DEBIT' : 'CREDIT' })) },
  });
  const { fields } = useFieldArray({ control, name: 'rows' });

  const mutation = useMutation({
    mutationFn: (d: { rows: unknown[] }) => openingBalancesApi.saveAccounts(d.rows),
    onSuccess: () => { toast.success('Account balances saved'); onSaved(); },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="space-y-4">
      <div className="max-h-80 overflow-y-auto space-y-2">
        {fields.map((field, i) => {
          const acc = leafAccounts.find((a) => a.id === field.accountId);
          return (
            <div key={field.id} className="flex items-center gap-3">
              <span className="font-mono text-xs text-gray-400 w-16">{acc?.accountCode as string}</span>
              <span className="text-sm text-gray-700 dark:text-gray-300 w-48 truncate">{acc?.name as string}</span>
              <Input type="number" step="0.01" {...register(`rows.${i}.amount`)} className="w-36" />
              <Select {...register(`rows.${i}.balanceType`)} className="w-28">
                <option value="DEBIT">Debit (Dr)</option>
                <option value="CREDIT">Credit (Cr)</option>
              </Select>
            </div>
          );
        })}
        {fields.length === 0 && <p className="text-sm text-gray-400">Seed CoA first.</p>}
      </div>
      <Button type="submit" loading={mutation.isPending}>Save & Next</Button>
    </form>
  );
}

// ── Step: Cash & Bank ────────────────────────────────────────────────────────
function CashBankStep({ onSaved }: { onSaved: () => void }) {
  const { data: accData } = useQuery({ queryKey: ['accounts'], queryFn: () => accountApi.list() });
  const accounts = ((accData as Record<string, unknown>)?.data as Record<string, unknown[]>)?.content ?? [];
  const cashBankAccounts = (accounts as Record<string, unknown>[]).filter((a) => a.isCash || a.isBank);

  const { control, register, handleSubmit } = useForm<{ rows: { accountId: number; amount: number; balanceType: string }[] }>({
    defaultValues: { rows: cashBankAccounts.map((a) => ({ accountId: a.id as number, amount: 0, balanceType: 'DEBIT' })) },
  });
  const { fields } = useFieldArray({ control, name: 'rows' });

  const mutation = useMutation({
    mutationFn: (d: { rows: unknown[] }) => openingBalancesApi.saveCashBank(d.rows),
    onSuccess: () => { toast.success('Cash & bank balances saved'); onSaved(); },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="space-y-4">
      <div className="max-h-80 overflow-y-auto space-y-2">
        {fields.map((field, i) => {
          const acc = cashBankAccounts.find((a) => a.id === field.accountId);
          return (
            <div key={field.id} className="flex items-center gap-3">
              <span className="font-mono text-xs text-gray-400 w-16">{acc?.accountCode as string}</span>
              <span className="text-sm text-gray-700 dark:text-gray-300 w-40 truncate">{acc?.name as string}</span>
              <Badge label={(acc?.isBank ? 'Bank' : 'Cash') as string} color={acc?.isBank ? 'blue' : 'green'} />
              <Input type="number" step="0.01" {...register(`rows.${i}.amount`)} className="w-36" />
            </div>
          );
        })}
        {fields.length === 0 && <p className="text-sm text-gray-400">No cash/bank accounts found. Seed CoA first.</p>}
      </div>
      <Button type="submit" loading={mutation.isPending}>Save & Review</Button>
    </form>
  );
}

// ── Main Wizard ──────────────────────────────────────────────────────────────
export default function OpeningBalancesPage() {
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const { data: statusData, isLoading } = useQuery({
    queryKey: ['ob-status'],
    queryFn: () => openingBalancesApi.status(),
  });
  const wizardStatus = ((statusData as Record<string, unknown>)?.data as WizardStatus | undefined);
  const isLocked = wizardStatus?.status === 'LOCKED';

  const lockMutation = useMutation({
    mutationFn: () => openingBalancesApi.lock(),
    onSuccess: () => { toast.success('Opening balances locked!'); qc.invalidateQueries({ queryKey: ['ob-status'] }); },
    onError: (err: Error) => toast.error(err.message),
  });

  const completionFlags = [
    wizardStatus?.customersComplete,
    wizardStatus?.suppliersComplete,
    wizardStatus?.stockComplete,
    wizardStatus?.accountsComplete,
    wizardStatus?.cashBankComplete,
  ];

  if (isLoading) return <p className="text-sm text-gray-400">Loading wizard status…</p>;

  return (
    <div>
      <ERPPageHeader variant="list"
        title="Opening Balances Wizard"
        subtitle={isLocked ? `Locked on ${formatDate(wizardStatus!.lockedAt!)}` : 'Enter balances as of your go-live date.'}
      />

      {isLocked && (
        <div className="mb-6 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-xl p-4 flex items-center gap-3">
          <span className="text-green-600 text-xl">🔒</span>
          <div>
            <p className="font-semibold text-green-700 dark:text-green-400">Opening balances are locked.</p>
            <p className="text-sm text-green-600 dark:text-green-500">Balances have been finalized and cannot be edited.</p>
          </div>
        </div>
      )}

      {/* Step tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 dark:bg-gray-800 p-1 rounded-xl">
        {STEPS.map((s, i) => (
          <button
            key={s.id}
            onClick={() => !isLocked && setStep(i)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-colors ${
              step === i
                ? 'bg-white dark:bg-gray-700 shadow text-gray-900 dark:text-gray-100'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            } ${isLocked ? 'cursor-default' : ''}`}
          >
            {completionFlags[i] ? (
              <span className="text-green-500 text-xs">✓</span>
            ) : (
              <span className="text-gray-400 text-xs">{i + 1}</span>
            )}
            <span className="hidden sm:inline">{s.label}</span>
          </button>
        ))}
      </div>

      {/* Step content */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <h2 className="text-base font-semibold text-gray-800 dark:text-gray-200 mb-4">{STEPS[step]?.label}</h2>
        {!isLocked && (
          <>
            {step === 0 && <CustomerBalancesStep onSaved={() => { qc.invalidateQueries({ queryKey: ['ob-status'] }); setStep(1); }} />}
            {step === 1 && <SupplierBalancesStep onSaved={() => { qc.invalidateQueries({ queryKey: ['ob-status'] }); setStep(2); }} />}
            {step === 2 && <StockStep onSaved={() => { qc.invalidateQueries({ queryKey: ['ob-status'] }); setStep(3); }} />}
            {step === 3 && <AccountBalancesStep onSaved={() => { qc.invalidateQueries({ queryKey: ['ob-status'] }); setStep(4); }} />}
            {step === 4 && <CashBankStep onSaved={() => { qc.invalidateQueries({ queryKey: ['ob-status'] }); }} />}
          </>
        )}
      </div>

      {/* Review & Lock */}
      {!isLocked && (
        <div className="mt-6 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-5">
          <h3 className="font-semibold text-amber-800 dark:text-amber-400 mb-2">Review & Lock</h3>
          <div className="flex flex-wrap gap-2 mb-4">
            {STEPS.map((s, i) => (
              <Badge
                key={s.id}
                label={`${s.label}: ${completionFlags[i] ? 'Done' : 'Pending'}`}
                color={completionFlags[i] ? 'green' : 'yellow'}
              />
            ))}
          </div>
          <p className="text-sm text-amber-700 dark:text-amber-500 mb-4">
            Once locked, opening balances cannot be modified. Ensure total debits = total credits before locking.
          </p>
          <Button
            variant="danger"
            onClick={() => lockMutation.mutate()}
            loading={lockMutation.isPending}
            disabled={!completionFlags.some(Boolean)}
          >
            Lock Opening Balances
          </Button>
        </div>
      )}
    </div>
  );
}
