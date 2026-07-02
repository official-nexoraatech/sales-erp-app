import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { alterationApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import Input from '../../components/ui/Input.js';
import Button from '../../components/ui/Button.js';
import { formatCurrency } from '../../lib/format.js';

interface LineItem { description: string; quantity: number; rate: number; amount: number; }

export default function AlterationFormPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [receivedDate, setReceivedDate] = useState(new Date().toISOString().slice(0, 10));
  const [promisedDate, setPromisedDate] = useState('');
  const [advanceAmount, setAdvanceAmount] = useState(0);
  const [items, setItems] = useState<LineItem[]>([{ description: '', quantity: 1, rate: 0, amount: 0 }]);

  const totalAmount = items.reduce((s, i) => s + i.amount, 0);
  const balanceDue = Math.max(0, totalAmount - advanceAmount);

  function updateItem(idx: number, patch: Partial<LineItem>) {
    setItems((prev) => {
      const next = [...prev];
      const merged = { ...next[idx], ...patch } as LineItem;
      merged.amount = merged.quantity * merged.rate;
      next[idx] = merged;
      return next;
    });
  }

  function addItem() {
    setItems((prev) => [...prev, { description: '', quantity: 1, rate: 0, amount: 0 }]);
  }

  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  const createMutation = useMutation({
    mutationFn: () => alterationApi.create({
      customerName, customerPhone, receivedDate, promisedDate,
      items: items.filter((i) => i.description.trim()),
      advanceAmount,
    }),
    onSuccess: () => {
      toast.success('Alteration order received');
      qc.invalidateQueries({ queryKey: ['alterations'] });
      navigate('/hr/alterations');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <ERPPageHeader variant="list" title="Receive Alteration Order" subtitle="Counter screen — capture customer, items, and assign a tailor next." />

      <div className="max-w-3xl space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <Input label="Customer Name" required value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
          <Input label="Customer Phone" required value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Input label="Received Date" type="date" value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} />
          <Input label="Promised Date" type="date" required value={promisedDate} onChange={(e) => setPromisedDate(e.target.value)} />
        </div>

        <div className="bg-surface-card rounded-xl border border-default p-4">
          <h3 className="font-semibold text-primary mb-3">Items</h3>
          <div className="space-y-3">
            {items.map((item, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                <Input label="Description" wrapperClassName="col-span-6" value={item.description} onChange={(e) => updateItem(idx, { description: e.target.value })} />
                <Input label="Qty" type="number" wrapperClassName="col-span-2" value={item.quantity} onChange={(e) => updateItem(idx, { quantity: Number(e.target.value) })} />
                <Input label="Rate" type="number" wrapperClassName="col-span-2" value={item.rate} onChange={(e) => updateItem(idx, { rate: Number(e.target.value) })} />
                <div className="col-span-1 text-sm font-mono pb-2">{formatCurrency(item.amount)}</div>
                <Button type="button" variant="danger-outline" size="sm" className="col-span-1" onClick={() => removeItem(idx)}>×</Button>
              </div>
            ))}
          </div>
          <Button type="button" variant="secondary" size="sm" className="mt-3" onClick={addItem}>+ Add Item</Button>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Input label="Advance Amount (₹)" type="number" value={advanceAmount} onChange={(e) => setAdvanceAmount(Number(e.target.value))} />
          <div className="flex flex-col justify-end">
            <p className="text-sm text-secondary">Total: <span className="font-mono font-semibold">{formatCurrency(totalAmount)}</span></p>
            <p className="text-sm text-secondary">Balance Due: <span className="font-mono font-semibold">{formatCurrency(balanceDue)}</span></p>
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <Button
            onClick={() => createMutation.mutate()}
            loading={createMutation.isPending}
            disabled={!customerName || !customerPhone || !promisedDate || items.every((i) => !i.description.trim())}
          >
            Receive Order
          </Button>
          <Button variant="secondary" onClick={() => navigate('/hr/alterations')}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}
