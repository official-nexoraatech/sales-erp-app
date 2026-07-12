import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, useFieldArray } from 'react-hook-form';
import toast from 'react-hot-toast';
import {
  openingBalancesApi,
  customerApi,
  supplierApi,
  accountApi,
  warehouseApi,
  itemApi,
} from '../../api/endpoints.js';
import { ApiError } from '../../api/client.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPFormSkeleton } from '../../components/erp/ERPSkeleton.js';
import Button from '../../components/ui/Button.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';
import Badge from '../../components/ui/Badge.js';
import { formatDate, formatCurrency } from '../../lib/format.js';

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
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const { data: custData } = useQuery({
    queryKey: ['customers'],
    queryFn: () => customerApi.list({ size: 200 }),
    enabled: hasPermission(PERMISSIONS.CUSTOMER_VIEW),
  });
  const customers =
    ((custData as Record<string, unknown>)?.content as Record<string, unknown>[]) ?? [];

  const { control, register, handleSubmit } = useForm<{
    rows: { customerId: number; amount: number; balanceType: string }[];
  }>({
    defaultValues: {
      rows: customers.map((c) => ({
        customerId: c.id as number,
        amount: Number(c.openingBalance ?? 0),
        balanceType: 'DEBIT',
      })),
    },
  });
  const { fields } = useFieldArray({ control, name: 'rows' });

  const mutation = useMutation({
    mutationFn: (d: { rows: unknown[] }) => openingBalancesApi.saveCustomers(d.rows),
    onSuccess: () => {
      toast.success('Customer balances saved');
      onSaved();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="space-y-4">
      <div className="max-h-80 overflow-y-auto space-y-2">
        {fields.map((field, i) => {
          const cust = customers.find((c) => c.id === field.customerId);
          return (
            <div key={field.id} className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-secondary w-48 truncate">
                {(cust?.displayName as string) ?? field.customerId}
              </span>
              <Input type="number" step="0.01" {...register(`rows.${i}.amount`)} className="w-36" />
              <Select {...register(`rows.${i}.balanceType`)} className="w-28">
                <option value="DEBIT">Debit (Dr)</option>
                <option value="CREDIT">Credit (Cr)</option>
              </Select>
            </div>
          );
        })}
        {fields.length === 0 && (
          <p className="text-sm text-secondary">No customers. Add customers first.</p>
        )}
      </div>
      <Button type="submit" loading={mutation.isPending}>
        Save & Next
      </Button>
    </form>
  );
}

// ── Step: Supplier Balances ──────────────────────────────────────────────────
function SupplierBalancesStep({ onSaved }: { onSaved: () => void }) {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const { data: suppData } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => supplierApi.list({ size: 200 }),
    enabled: hasPermission(PERMISSIONS.SUPPLIER_VIEW),
  });
  const suppliers =
    ((suppData as Record<string, unknown>)?.content as Record<string, unknown>[]) ?? [];

  const { control, register, handleSubmit } = useForm<{
    rows: { supplierId: number; amount: number; balanceType: string }[];
  }>({
    defaultValues: {
      rows: suppliers.map((s) => ({
        supplierId: s.id as number,
        amount: Number(s.openingBalance ?? 0),
        balanceType: 'CREDIT',
      })),
    },
  });
  const { fields } = useFieldArray({ control, name: 'rows' });

  const mutation = useMutation({
    mutationFn: (d: { rows: unknown[] }) => openingBalancesApi.saveSuppliers(d.rows),
    onSuccess: () => {
      toast.success('Supplier balances saved');
      onSaved();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="space-y-4">
      <div className="max-h-80 overflow-y-auto space-y-2">
        {fields.map((field, i) => {
          const supp = suppliers.find((s) => s.id === field.supplierId);
          return (
            <div key={field.id} className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-secondary w-48 truncate">
                {(supp?.displayName as string) ?? field.supplierId}
              </span>
              <Input type="number" step="0.01" {...register(`rows.${i}.amount`)} className="w-36" />
              <Select {...register(`rows.${i}.balanceType`)} className="w-28">
                <option value="CREDIT">Credit (Cr)</option>
                <option value="DEBIT">Debit (Dr)</option>
              </Select>
            </div>
          );
        })}
        {fields.length === 0 && (
          <p className="text-sm text-secondary">No suppliers. Add suppliers first.</p>
        )}
      </div>
      <Button type="submit" loading={mutation.isPending}>
        Save & Next
      </Button>
    </form>
  );
}

// ── Step: Stock ──────────────────────────────────────────────────────────────
function StockStep({ onSaved }: { onSaved: () => void }) {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const { data: itemData } = useQuery({
    queryKey: ['items'],
    queryFn: () => itemApi.list({ size: 200 }),
    enabled: hasPermission(PERMISSIONS.ITEM_VIEW),
  });
  const { data: whData } = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => warehouseApi.list(),
    enabled: hasPermission(PERMISSIONS.WAREHOUSE_VIEW),
  });
  const items = ((itemData as Record<string, unknown>)?.content as Record<string, unknown>[]) ?? [];
  const warehouses = (whData as { content?: unknown[] })?.content ?? [];
  const defaultWh =
    (warehouses as Record<string, unknown>[]).find((w) => w.isDefault) ?? warehouses[0];

  const { control, register, handleSubmit } = useForm<{
    rows: { itemId: number; quantity: number; unitCost: number; warehouseId: number }[];
  }>({
    defaultValues: {
      rows: items
        .filter((i) => i.trackInventory)
        .map((i) => ({
          itemId: i.id as number,
          quantity: 0,
          unitCost: Number(i.purchasePrice ?? 0),
          warehouseId: (defaultWh as Record<string, unknown>)?.id as number,
        })),
    },
  });
  const { fields } = useFieldArray({ control, name: 'rows' });

  const mutation = useMutation({
    mutationFn: (d: { rows: unknown[] }) => openingBalancesApi.saveStock(d.rows),
    onSuccess: () => {
      toast.success('Stock opening balances saved');
      onSaved();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="space-y-4">
      {fields.length === 0 && <p className="text-sm text-secondary">No tracked items found.</p>}
      <div className="max-h-80 overflow-y-auto space-y-2">
        {fields.map((field, i) => {
          const item = items.find((it) => it.id === field.itemId);
          return (
            <div key={field.id} className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-secondary w-40 truncate">
                {(item?.name as string) ?? field.itemId}
              </span>
              <Input
                type="number"
                step="0.001"
                placeholder="Qty"
                {...register(`rows.${i}.quantity`)}
                className="w-24"
              />
              <Input
                type="number"
                step="0.01"
                placeholder="Cost/unit"
                {...register(`rows.${i}.unitCost`)}
                className="w-28"
              />
              <Select {...register(`rows.${i}.warehouseId`)} className="w-32">
                {(warehouses as Record<string, unknown>[]).map((w) => (
                  <option key={w.id as number} value={w.id as number}>
                    {w.name as string}
                  </option>
                ))}
              </Select>
            </div>
          );
        })}
      </div>
      <Button type="submit" loading={mutation.isPending}>
        Save & Next
      </Button>
    </form>
  );
}

// ── Step: Account Balances ───────────────────────────────────────────────────
function AccountBalancesStep({ onSaved }: { onSaved: () => void }) {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const { data: accData } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => accountApi.list(),
    enabled: hasPermission(PERMISSIONS.ACCOUNT_VIEW),
  });
  const accounts = (accData as Record<string, unknown[]>)?.content ?? [];
  const leafAccounts = (accounts as Record<string, unknown>[]).filter(
    (a) => !a.isSystem && !a.isCash && !a.isBank
  );

  const { control, register, handleSubmit } = useForm<{
    rows: { accountId: number; amount: number; balanceType: string }[];
  }>({
    defaultValues: {
      rows: leafAccounts.map((a) => ({
        accountId: a.id as number,
        amount: Number(a.openingBalance ?? 0),
        balanceType: (a.normalBalance as string) === 'DEBIT' ? 'DEBIT' : 'CREDIT',
      })),
    },
  });
  const { fields } = useFieldArray({ control, name: 'rows' });

  const mutation = useMutation({
    mutationFn: (d: { rows: unknown[] }) => openingBalancesApi.saveAccounts(d.rows),
    onSuccess: () => {
      toast.success('Account balances saved');
      onSaved();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="space-y-4">
      <div className="max-h-80 overflow-y-auto space-y-2">
        {fields.map((field, i) => {
          const acc = leafAccounts.find((a) => a.id === field.accountId);
          return (
            <div key={field.id} className="flex flex-wrap items-center gap-3">
              <span className="font-mono text-xs text-disabled w-16">
                {acc?.accountCode as string}
              </span>
              <span className="text-sm text-secondary w-48 truncate">{acc?.name as string}</span>
              <Input type="number" step="0.01" {...register(`rows.${i}.amount`)} className="w-36" />
              <Select {...register(`rows.${i}.balanceType`)} className="w-28">
                <option value="DEBIT">Debit (Dr)</option>
                <option value="CREDIT">Credit (Cr)</option>
              </Select>
            </div>
          );
        })}
        {fields.length === 0 && <p className="text-sm text-secondary">Seed CoA first.</p>}
      </div>
      <Button type="submit" loading={mutation.isPending}>
        Save & Next
      </Button>
    </form>
  );
}

// ── Step: Cash & Bank ────────────────────────────────────────────────────────
function CashBankStep({ onSaved }: { onSaved: () => void }) {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const { data: accData } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => accountApi.list(),
    enabled: hasPermission(PERMISSIONS.ACCOUNT_VIEW),
  });
  const accounts = (accData as Record<string, unknown[]>)?.content ?? [];
  const cashBankAccounts = (accounts as Record<string, unknown>[]).filter(
    (a) => a.isCash || a.isBank
  );

  const { control, register, handleSubmit } = useForm<{
    rows: { accountId: number; amount: number; balanceType: string }[];
  }>({
    defaultValues: {
      rows: cashBankAccounts.map((a) => ({
        accountId: a.id as number,
        amount: 0,
        balanceType: 'DEBIT',
      })),
    },
  });
  const { fields } = useFieldArray({ control, name: 'rows' });

  const mutation = useMutation({
    mutationFn: (d: { rows: unknown[] }) => openingBalancesApi.saveCashBank(d.rows),
    onSuccess: () => {
      toast.success('Cash & bank balances saved');
      onSaved();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="space-y-4">
      <div className="max-h-80 overflow-y-auto space-y-2">
        {fields.map((field, i) => {
          const acc = cashBankAccounts.find((a) => a.id === field.accountId);
          return (
            <div key={field.id} className="flex flex-wrap items-center gap-3">
              <span className="font-mono text-xs text-disabled w-16">
                {acc?.accountCode as string}
              </span>
              <span className="text-sm text-secondary w-40 truncate">{acc?.name as string}</span>
              <Badge
                label={(acc?.isBank ? 'Bank' : 'Cash') as string}
                color={acc?.isBank ? 'blue' : 'green'}
              />
              <Input type="number" step="0.01" {...register(`rows.${i}.amount`)} className="w-36" />
            </div>
          );
        })}
        {fields.length === 0 && (
          <p className="text-sm text-secondary">No cash/bank accounts found. Seed CoA first.</p>
        )}
      </div>
      <Button type="submit" loading={mutation.isPending}>
        Save & Review
      </Button>
    </form>
  );
}

// ── Main Wizard ──────────────────────────────────────────────────────────────
const CATEGORY_LABELS: Record<string, string> = {
  customers: 'Customers',
  suppliers: 'Suppliers',
  stock: 'Stock',
  accounts: 'Accounts',
  cashBank: 'Cash & Bank',
};

export default function OpeningBalancesPage() {
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [lockError, setLockError] = useState<ApiError | null>(null);
  const { data: statusData, isLoading } = useQuery({
    queryKey: ['ob-status'],
    queryFn: () => openingBalancesApi.status(),
  });
  const wizardStatus = statusData as WizardStatus | undefined;
  const isLocked = wizardStatus?.status === 'LOCKED';

  const lockMutation = useMutation({
    mutationFn: () => openingBalancesApi.lock(),
    onSuccess: () => {
      setLockError(null);
      toast.success('Opening balances locked!');
      qc.invalidateQueries({ queryKey: ['ob-status'] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
      setLockError(err instanceof ApiError ? err : null);
    },
  });

  const completionFlags = [
    wizardStatus?.customersComplete,
    wizardStatus?.suppliersComplete,
    wizardStatus?.stockComplete,
    wizardStatus?.accountsComplete,
    wizardStatus?.cashBankComplete,
  ];

  if (isLoading) return <ERPFormSkeleton />;

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Opening Balances Wizard"
        subtitle={
          isLocked
            ? `Locked on ${formatDate(wizardStatus!.lockedAt!)}`
            : 'Enter balances as of your go-live date.'
        }
      />

      {isLocked && (
        <div className="mb-6 bg-success-bg border border-success rounded-xl p-4 flex items-center gap-3">
          <span className="text-success text-xl">🔒</span>
          <div>
            <p className="font-semibold text-success">Opening balances are locked.</p>
            <p className="text-sm text-success">
              Balances have been finalized and cannot be edited.
            </p>
          </div>
        </div>
      )}

      {/* Step tabs */}
      <div className="flex gap-1 mb-6 bg-surface-subtle p-1 rounded-xl">
        {STEPS.map((s, i) => (
          <button
            key={s.id}
            onClick={() => !isLocked && setStep(i)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-colors ${
              step === i
                ? 'bg-surface-card shadow text-primary'
                : 'text-disabled hover:text-secondary'
            } ${isLocked ? 'cursor-default' : ''}`}
          >
            {completionFlags[i] ? (
              <span className="text-success text-xs">✓</span>
            ) : (
              <span className="text-disabled text-xs">{i + 1}</span>
            )}
            <span className="hidden sm:inline">{s.label}</span>
          </button>
        ))}
      </div>

      {/* Step content */}
      <div className="bg-surface-card rounded-xl border border-default p-6">
        <h2 className="text-base font-semibold text-primary mb-4">{STEPS[step]?.label}</h2>
        {!isLocked && (
          <>
            {step === 0 && (
              <CustomerBalancesStep
                onSaved={() => {
                  qc.invalidateQueries({ queryKey: ['ob-status'] });
                  setStep(1);
                }}
              />
            )}
            {step === 1 && (
              <SupplierBalancesStep
                onSaved={() => {
                  qc.invalidateQueries({ queryKey: ['ob-status'] });
                  setStep(2);
                }}
              />
            )}
            {step === 2 && (
              <StockStep
                onSaved={() => {
                  qc.invalidateQueries({ queryKey: ['ob-status'] });
                  setStep(3);
                }}
              />
            )}
            {step === 3 && (
              <AccountBalancesStep
                onSaved={() => {
                  qc.invalidateQueries({ queryKey: ['ob-status'] });
                  setStep(4);
                }}
              />
            )}
            {step === 4 && (
              <CashBankStep
                onSaved={() => {
                  qc.invalidateQueries({ queryKey: ['ob-status'] });
                }}
              />
            )}
          </>
        )}
      </div>

      {/* Review & Lock */}
      {!isLocked && (
        <div className="mt-6 bg-warning-bg border border-warning rounded-xl p-5">
          <h3 className="font-semibold text-warning mb-2">Review & Lock</h3>
          <div className="flex flex-wrap gap-2 mb-4">
            {STEPS.map((s, i) => (
              <Badge
                key={s.id}
                label={`${s.label}: ${completionFlags[i] ? 'Done' : 'Pending'}`}
                color={completionFlags[i] ? 'green' : 'yellow'}
              />
            ))}
          </div>
          <p className="text-sm text-warning mb-4">
            Once locked, opening balances cannot be modified. Ensure total debits = total credits
            before locking.
          </p>
          <Button
            variant="danger"
            onClick={() => lockMutation.mutate()}
            loading={lockMutation.isPending}
            disabled={!completionFlags.some(Boolean)}
          >
            Lock Opening Balances
          </Button>

          {lockError?.code === 'TRIAL_BALANCE_MISMATCH' && (
            <div className="mt-4 bg-error-bg border border-error rounded-lg p-4">
              <p className="text-sm font-semibold text-error mb-2">
                Trial balance mismatch — off by{' '}
                {formatCurrency(Number(lockError.details?.overallDifference ?? 0))}
              </p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-error">
                    <th className="pb-1 font-medium">Step</th>
                    <th className="pb-1 font-medium text-right">Debit</th>
                    <th className="pb-1 font-medium text-right">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(CATEGORY_LABELS).map(([key, label]) => {
                    const cat = lockError.details?.[key] as
                      { debit: number; credit: number } | undefined;
                    if (!cat) return null;
                    return (
                      <tr key={key} className="text-error">
                        <td className="py-0.5">{label}</td>
                        <td className="py-0.5 text-right">{formatCurrency(cat.debit)}</td>
                        <td className="py-0.5 text-right">{formatCurrency(cat.credit)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="text-xs text-error mt-2">
                Go back to the step(s) above whose debit and credit don't line up with the rest, and
                fix the amounts.
              </p>
            </div>
          )}

          {lockError?.code === 'OPENING_BALANCE_DOUBLE_ENTRY' && (
            <div className="mt-4 bg-error-bg border border-error rounded-lg p-4">
              <p className="text-sm font-semibold text-error mb-2">
                Double-entry detected in the Accounts step
              </p>
              <p className="text-sm text-error mb-2">{lockError.message}</p>
              <ul className="text-xs text-error list-disc list-inside">
                {(
                  (lockError.details?.violations as
                    { accountId: number; accountSubType: string; amount: number }[] | undefined) ??
                  []
                ).map((v) => (
                  <li key={v.accountId}>
                    Account #{v.accountId} ({v.accountSubType}) — {formatCurrency(v.amount)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
