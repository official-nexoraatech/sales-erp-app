import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { portalApiClient } from '../api/portalApiClient.js';

interface OrderLine {
  id: number;
  description: string | null;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
}

interface OrderDetail {
  id: number;
  invoiceNumber: string | null;
  invoiceDate: string;
  status: string;
  grandTotal: string;
  balanceDue: string;
  lines: OrderLine[];
}

export function PortalOrderDetailPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading } = useQuery({
    queryKey: ['portal', 'orders', id],
    queryFn: () => portalApiClient.get<OrderDetail>('sales', `/portal/orders/${id}`),
  });

  if (isLoading) return <p className="text-sm text-[var(--text-secondary)]">Loading…</p>;
  if (!data) return <p className="text-sm text-[var(--text-secondary)]">Order not found.</p>;

  return (
    <div className="space-y-4">
      <Link
        to="/"
        className="flex items-center gap-1 text-sm text-[var(--text-secondary)] hover:underline"
      >
        <ArrowLeft size={16} /> Back to orders
      </Link>
      <h1 className="text-xl font-semibold">{data.invoiceNumber ?? `Order #${data.id}`}</h1>
      <p className="text-sm text-[var(--text-secondary)]">
        {new Date(data.invoiceDate).toLocaleDateString()} · {data.status}
      </p>

      <div className="overflow-hidden rounded-lg border border-[var(--border-default)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--surface-subtle)] text-left text-[var(--text-secondary)]">
            <tr>
              <th className="px-4 py-2">Item</th>
              <th className="px-4 py-2 text-right">Qty</th>
              <th className="px-4 py-2 text-right">Rate</th>
              <th className="px-4 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {(data.lines ?? []).map((line) => (
              <tr key={line.id} className="border-t border-[var(--border-default)]">
                <td className="px-4 py-2">{line.description ?? `Item ${line.id}`}</td>
                <td className="px-4 py-2 text-right">{line.quantity}</td>
                <td className="px-4 py-2 text-right">₹{line.unitPrice}</td>
                <td className="px-4 py-2 text-right">₹{line.lineTotal}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end gap-8 text-sm">
        <div>
          <div className="text-[var(--text-secondary)]">Grand total</div>
          <div className="text-lg font-semibold">₹{data.grandTotal}</div>
        </div>
        <div>
          <div className="text-[var(--text-secondary)]">Balance due</div>
          <div className="text-lg font-semibold">₹{data.balanceDue}</div>
        </div>
      </div>
    </div>
  );
}
