import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { supplierPaymentApi, tdsApi, accountApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPFormSection from '../../components/erp/ERPFormSection.js';
import ERPStickyFooter from '../../components/erp/ERPStickyFooter.js';
import Button from '../../components/ui/Button.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';
import Checkbox from '../../components/ui/Checkbox.js';

const LIST_PATH = '/purchase/payments';

// Mirrors accounting-service's TDSService.TDS_SECTION_RATES — this codebase's established
// pattern for cross-service business tables (see GSTCalculator, duplicated per-service) is a
// small duplicated copy rather than a synchronous cross-service call just to read a constant.
const TDS_CATEGORIES = [
  {
    value: '194C_INDIVIDUAL',
    label: '194C — Contractor (Individual/HUF), 1%',
    rate: 1,
    threshold: 30000,
  },
  { value: '194C_COMPANY', label: '194C — Contractor (Others), 2%', rate: 2, threshold: 30000 },
  { value: '194H', label: '194H — Commission/Brokerage, 5%', rate: 5, threshold: 15000 },
  {
    value: '194J_PROFESSIONAL',
    label: '194J — Professional Services, 10%',
    rate: 10,
    threshold: 30000,
  },
  { value: '194J_TECHNICAL', label: '194J — Technical Services, 2%', rate: 2, threshold: 30000 },
] as const;

export default function SupplierPaymentFormPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  // Was hardcoded to 1 — same latent multi-tenant bug class fixed elsewhere this session.
  const userBranchId = useAuthStore((s) => s.user?.branchIds?.[0]);
  const canManageTds = hasPermission(PERMISSIONS.TDS_MANAGE);

  const [supplierId, setSupplierId] = useState('');
  const [paymentDate, setPaymentDate] = useState<string>(new Date().toISOString().substring(0, 10));
  const [paymentMode, setPaymentMode] = useState('CASH');
  const [amount, setAmount] = useState('');
  const [chequeNumber, setChequeNumber] = useState('');
  const [pdcClearingDate, setPdcClearingDate] = useState('');
  const [transactionRef, setTransactionRef] = useState('');
  const [notes, setNotes] = useState('');

  // Purchase audit 2026-07-21: TDSService/POST /tds/deduct already existed in
  // accounting-service but nothing in the purchase workflow ever called it — a payment
  // that's actually subject to TDS (e.g. a contractor/professional-fee payment recorded
  // through this same Supplier Payments module) had to be deducted via a separate,
  // undiscoverable manual API call. This makes it reachable from the one place a
  // TDS-liable payment actually gets recorded.
  const [tdsEnabled, setTdsEnabled] = useState(false);
  const [tdsCategory, setTdsCategory] =
    useState<(typeof TDS_CATEGORIES)[number]['value']>('194C_INDIVIDUAL');
  const [tdsExpenseAccountId, setTdsExpenseAccountId] = useState('');
  const [tdsPayableAccountId, setTdsPayableAccountId] = useState('');

  const { data: accountsData } = useQuery({
    queryKey: ['accounts-for-tds'],
    queryFn: () => accountApi.list(),
    enabled: tdsEnabled && canManageTds,
  });
  const accountOptions = (
    ((accountsData as { content?: unknown[] })?.content as
      { id: number; accountCode: string; name: string }[] | undefined) ?? []
  ).map((a) => ({ value: String(a.id), label: `${a.accountCode} — ${a.name}` }));

  useEffect(() => {
    const rawAccounts = (accountsData as { content?: unknown[] })?.content as
      { id: number; accountCode: string }[] | undefined;
    const tdsPayable = rawAccounts?.find((a) => a.accountCode === '2340');
    if (tdsPayable && !tdsPayableAccountId) setTdsPayableAccountId(String(tdsPayable.id));
  }, [accountsData, tdsPayableAccountId]);

  const selectedTdsRule = TDS_CATEGORIES.find((c) => c.value === tdsCategory)!;
  const grossAmount = parseFloat(amount || '0');
  const tdsAmount =
    tdsEnabled && grossAmount >= selectedTdsRule.threshold
      ? Math.round(grossAmount * selectedTdsRule.rate) / 100
      : 0;

  const createMutation = useMutation({
    mutationFn: (d: Record<string, unknown>) => supplierPaymentApi.create(d),
  });

  const tdsMutation = useMutation({
    mutationFn: (d: Record<string, unknown>) => tdsApi.deduct(d),
  });

  const handleSubmit = async () => {
    try {
      const created = (await createMutation.mutateAsync({
        supplierId: Number(supplierId),
        branchId: userBranchId,
        paymentDate: new Date(paymentDate).toISOString(),
        paymentMode,
        amount: grossAmount,
        chequeNumber: chequeNumber || undefined,
        pdcClearingDate: pdcClearingDate ? new Date(pdcClearingDate).toISOString() : undefined,
        transactionReference: transactionRef || undefined,
        notes: notes || undefined,
      })) as { id: number };

      if (tdsEnabled && tdsAmount > 0 && tdsPayableAccountId && tdsExpenseAccountId) {
        const d = new Date(paymentDate);
        try {
          await tdsMutation.mutateAsync({
            supplierId: Number(supplierId),
            paymentId: created.id,
            grossAmount,
            category: tdsCategory,
            tdsPayableAccountId: Number(tdsPayableAccountId),
            expenseAccountId: Number(tdsExpenseAccountId),
            periodMonth: d.getMonth() + 1,
            periodYear: d.getFullYear(),
          });
          toast.success(`Payment recorded — ₹${tdsAmount.toFixed(2)} TDS deducted`);
        } catch (tdsErr) {
          // Payment already succeeded — don't lose that on a TDS-specific failure, just
          // surface it so the user can record the deduction manually via Accounting > TDS.
          toast.error(`Payment recorded, but TDS deduction failed: ${(tdsErr as Error).message}`);
        }
      } else {
        toast.success('Payment recorded');
      }
      qc.invalidateQueries({ queryKey: ['supplier-payments'] });
      navigate(LIST_PATH);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const isPdc =
    paymentMode === 'CHEQUE' && !!pdcClearingDate && new Date(pdcClearingDate) > new Date();

  return (
    <div>
      <ERPPageHeader
        variant="detail"
        title="Record Supplier Payment"
        subtitle="Record a payment made to a supplier"
        backTo={LIST_PATH}
      />

      <ERPFormSection title="Payment Details" columns={2}>
        <Input
          label="Supplier ID *"
          type="number"
          placeholder="Supplier ID"
          value={supplierId}
          onChange={(e) => setSupplierId(e.target.value)}
        />
        <Input
          label="Payment Date *"
          type="date"
          value={paymentDate}
          onChange={(e) => setPaymentDate(e.target.value)}
        />
        <Select
          label="Payment Mode *"
          value={paymentMode}
          onChange={(e) => setPaymentMode(e.target.value)}
          options={['CASH', 'CHEQUE', 'NEFT', 'RTGS', 'UPI'].map((m) => ({ value: m, label: m }))}
        />
        <Input
          label="Amount *"
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        {paymentMode === 'CHEQUE' && (
          <>
            <Input
              label="Cheque Number"
              value={chequeNumber}
              onChange={(e) => setChequeNumber(e.target.value)}
            />
            <Input
              label="PDC Clearing Date (leave blank if not PDC)"
              type="date"
              value={pdcClearingDate}
              onChange={(e) => setPdcClearingDate(e.target.value)}
            />
            {isPdc && (
              <p className="text-xs text-warning sm:col-span-2">
                This will be recorded as a Post-Dated Cheque (PDC).
              </p>
            )}
          </>
        )}
        {['UPI', 'NEFT', 'RTGS'].includes(paymentMode) && (
          <Input
            label="Transaction Reference"
            value={transactionRef}
            onChange={(e) => setTransactionRef(e.target.value)}
          />
        )}
        <Input
          label="Notes"
          wrapperClassName="sm:col-span-2"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </ERPFormSection>

      {canManageTds && (
        <ERPFormSection title="TDS Deduction" columns={2}>
          <div className="sm:col-span-2">
            <Checkbox
              label="This payment is subject to TDS"
              description="Deducts tax at source and records it against this payment — only applicable to contractor/commission/professional-fee type payments, not ordinary goods purchases"
              checked={tdsEnabled}
              onChange={(e) => setTdsEnabled(e.target.checked)}
            />
          </div>
          {tdsEnabled && (
            <>
              <Select
                label="TDS Section"
                value={tdsCategory}
                onChange={(e) =>
                  setTdsCategory(e.target.value as (typeof TDS_CATEGORIES)[number]['value'])
                }
                options={TDS_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))}
              />
              <div className="text-sm text-secondary self-end pb-2">
                {grossAmount < selectedTdsRule.threshold
                  ? `Below ₹${selectedTdsRule.threshold.toLocaleString('en-IN')} threshold — no TDS applies`
                  : `TDS to deduct: ₹${tdsAmount.toFixed(2)} (net payable: ₹${(grossAmount - tdsAmount).toFixed(2)})`}
              </div>
              <Select
                label="Expense Account"
                value={tdsExpenseAccountId}
                onChange={(e) => setTdsExpenseAccountId(e.target.value)}
                options={[{ value: '', label: 'Select account…' }, ...accountOptions]}
              />
              <Select
                label="TDS Payable Account"
                value={tdsPayableAccountId}
                onChange={(e) => setTdsPayableAccountId(e.target.value)}
                options={[{ value: '', label: 'Select account…' }, ...accountOptions]}
              />
            </>
          )}
        </ERPFormSection>
      )}

      <ERPStickyFooter>
        <Button variant="secondary" onClick={() => navigate(LIST_PATH)}>
          Cancel
        </Button>
        <Button
          isLoading={createMutation.isPending || tdsMutation.isPending}
          disabled={
            !supplierId ||
            !amount ||
            (tdsEnabled && tdsAmount > 0 && (!tdsExpenseAccountId || !tdsPayableAccountId))
          }
          onClick={handleSubmit}
        >
          Record Payment
        </Button>
      </ERPStickyFooter>
    </div>
  );
}
