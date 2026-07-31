import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { portalApiClient } from '../api/portalApiClient.js';

interface OrderRow {
  id: number;
  invoiceNumber: string | null;
  invoiceDate: string;
  status: string;
  grandTotal: string;
  balanceDue: string;
}

export function PortalDashboardPage(): React.ReactElement {
  const { data, isLoading } = useQuery({
    queryKey: ['portal', 'orders'],
    queryFn: () =>
      portalApiClient.get<{ content: OrderRow[]; totalElements: number }>(
        'sales',
        '/portal/orders'
      ),
  });

  if (isLoading)
    return <p className="text-sm text-[var(--text-secondary)]">Loading your orders…</p>;

  const orders = data?.content ?? [];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">My Orders</h1>
      {orders.length === 0 ? (
        <p className="text-sm text-[var(--text-secondary)]">You have no orders yet.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-[var(--border-default)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--surface-subtle)] text-left text-[var(--text-secondary)]">
              <tr>
                <th className="px-4 py-2">Order #</th>
                <th className="px-4 py-2">Date</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2 text-right">Total</th>
                <th className="px-4 py-2 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-t border-[var(--border-default)]">
                  <td className="px-4 py-2">
                    <Link
                      to={`/orders/${o.id}`}
                      className="text-[var(--action-primary,#2563eb)] hover:underline"
                    >
                      {o.invoiceNumber ?? `#${o.id}`}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{new Date(o.invoiceDate).toLocaleDateString()}</td>
                  <td className="px-4 py-2">{o.status}</td>
                  <td className="px-4 py-2 text-right">₹{o.grandTotal}</td>
                  <td className="px-4 py-2 text-right">₹{o.balanceDue}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
