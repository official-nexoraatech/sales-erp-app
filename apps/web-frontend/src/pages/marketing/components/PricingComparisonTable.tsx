import { Check, Minus } from 'lucide-react';
import MarketingSection from '../../../components/marketing/MarketingSection.js';

// Mirrors the real feature_flags arrays per plan in
// packages/db-client/migrations/0040_pg027_billing_entitlements.sql — every row below maps to
// an actual flag key, not an invented capability.
const ROWS: {
  label: string;
  starter: boolean | string;
  growth: boolean | string;
  enterprise: boolean | string;
}[] = [
  { label: 'Users', starter: '5', growth: '25', enterprise: 'Unlimited' },
  { label: 'Branches', starter: '1', growth: '5', enterprise: 'Unlimited' },
  { label: 'Sales, purchase & inventory', starter: true, growth: true, enterprise: true },
  { label: 'Quotations & credit-limit checks', starter: true, growth: true, enterprise: true },
  { label: 'Auto-journal posting', starter: true, growth: true, enterprise: true },
  { label: 'Email & SMS notifications', starter: true, growth: true, enterprise: true },
  { label: 'Multi-branch operations', starter: false, growth: true, enterprise: true },
  { label: 'GST e-Invoice generation', starter: false, growth: true, enterprise: true },
  { label: 'GST e-Way Bill generation', starter: false, growth: true, enterprise: true },
  { label: 'Point of Sale (POS)', starter: false, growth: true, enterprise: true },
  { label: 'HR payroll', starter: false, growth: false, enterprise: true },
  { label: 'HR attendance tracking', starter: false, growth: false, enterprise: true },
  { label: 'WhatsApp notifications', starter: false, growth: false, enterprise: true },
];

function Cell({ value }: { value: boolean | string }) {
  if (typeof value === 'string')
    return <span className="text-sm font-medium text-primary">{value}</span>;
  return value ? (
    <Check className="h-4 w-4 text-success mx-auto" aria-label="Included" />
  ) : (
    <Minus className="h-4 w-4 text-disabled mx-auto" aria-label="Not included" />
  );
}

export default function PricingComparisonTable() {
  return (
    <MarketingSection surface="card" className="py-24">
      <div className="max-w-2xl mx-auto text-center mb-12">
        <h2 className="font-display font-semibold text-display-sm text-primary">
          Compare plans in detail
        </h2>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-default">
        <table className="w-full text-sm min-w-[560px]">
          <thead className="bg-surface-page">
            <tr className="border-b border-default">
              <th className="text-left font-semibold text-primary px-5 py-4">Feature</th>
              <th className="font-semibold text-primary px-5 py-4">Starter</th>
              <th className="font-semibold text-primary px-5 py-4">Growth</th>
              <th className="font-semibold text-primary px-5 py-4">Enterprise</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-default">
            {ROWS.map((row) => (
              <tr key={row.label} className="bg-surface-page">
                <td className="px-5 py-3.5 text-primary">{row.label}</td>
                <td className="px-5 py-3.5 text-center">
                  <Cell value={row.starter} />
                </td>
                <td className="px-5 py-3.5 text-center">
                  <Cell value={row.growth} />
                </td>
                <td className="px-5 py-3.5 text-center">
                  <Cell value={row.enterprise} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </MarketingSection>
  );
}
