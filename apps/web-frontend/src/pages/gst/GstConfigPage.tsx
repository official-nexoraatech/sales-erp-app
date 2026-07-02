import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { gstApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import Input from '../../components/ui/Input.js';

interface GstRate { id: number; rate: string; description: string; isActive: boolean; }
interface HsnResult { hsnCode: string; description: string; gstRate: string; cessRate: string; chapter: string; }

export default function GstConfigPage() {
  const qc = useQueryClient();
  const [hsnQuery, setHsnQuery] = useState('');
  const [hsnResults, setHsnResults] = useState<HsnResult[]>([]);
  const [computeInput, setComputeInput] = useState({ taxableAmount: 1000, gstRate: 18, isInterstate: false });
  const [computeResult, setComputeResult] = useState<Record<string, unknown> | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ['gst-rates'], queryFn: () => gstApi.rates() });
  const rates: GstRate[] = (data as { data?: { content?: GstRate[] } })?.data?.content ?? [];

  const seedMutation = useMutation({
    mutationFn: () => fetch('http://localhost:3018/gst/seed-rates', { method: 'POST' }).then((r) => r.json()),
    onSuccess: () => { toast.success('GST rates seeded'); qc.invalidateQueries({ queryKey: ['gst-rates'] }); },
    onError: () => toast.error('Seed failed'),
  });

  async function searchHsn() {
    if (!hsnQuery) return;
    try {
      const res = await gstApi.searchHsn(hsnQuery);
      setHsnResults(((res as Record<string, unknown>)?.content ?? []) as HsnResult[]);
    } catch { toast.error('HSN search failed'); }
  }

  async function computeGst() {
    try {
      const res = await gstApi.compute(computeInput);
      setComputeResult(res as Record<string, unknown>);
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Compute failed'); }
  }

  return (
    <div>
      <ERPPageHeader variant="list"
        title="GST Configuration"
        subtitle="Manage GST rates and HSN codes."
        actions={
          <Button variant="secondary" onClick={() => seedMutation.mutate()} loading={seedMutation.isPending}>
            Seed Default Rates
          </Button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Rates */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">GST Rates</h2>
          {isLoading ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : (
            <div className="space-y-2">
              {rates.map((r) => (
                <div key={r.id} className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-700 last:border-0">
                  <div>
                    <span className="font-bold text-lg text-gray-900 dark:text-gray-100">{r.rate}%</span>
                    <span className="ml-2 text-sm text-gray-500">{r.description}</span>
                  </div>
                  <Badge label={r.isActive ? 'Active' : 'Inactive'} color={r.isActive ? 'green' : 'gray'} />
                </div>
              ))}
              {rates.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-4">No rates found. Click "Seed Default Rates" to add standard GST rates.</p>
              )}
            </div>
          )}
        </div>

        {/* HSN Search */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">HSN Lookup</h2>
          <div className="flex gap-2 mb-4">
            <Input
              placeholder="Search by HSN code or description…"
              value={hsnQuery}
              onChange={(e) => setHsnQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && searchHsn()}
            />
            <Button variant="secondary" onClick={searchHsn}>Search</Button>
          </div>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {hsnResults.map((h) => (
              <div key={h.hsnCode} className="py-2 border-b border-gray-100 dark:border-gray-700 last:border-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-bold text-indigo-600 dark:text-indigo-400">{h.hsnCode}</span>
                  <Badge label={`GST ${h.gstRate}%`} color="blue" />
                  {Number(h.cessRate) > 0 && <Badge label={`Cess ${h.cessRate}%`} color="yellow" />}
                </div>
                <p className="text-xs text-gray-500 mt-0.5">{h.description}</p>
              </div>
            ))}
          </div>
        </div>

        {/* GST Calculator */}
        <div className="lg:col-span-2 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">GST Calculator</h2>
          <div className="grid grid-cols-3 gap-4 mb-4">
            <Input
              label="Taxable Amount (₹)"
              type="number"
              value={computeInput.taxableAmount}
              onChange={(e) => setComputeInput((p) => ({ ...p, taxableAmount: Number(e.target.value) }))}
            />
            <Input
              label="GST Rate %"
              type="number"
              value={computeInput.gstRate}
              onChange={(e) => setComputeInput((p) => ({ ...p, gstRate: Number(e.target.value) }))}
            />
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={computeInput.isInterstate}
                  onChange={(e) => setComputeInput((p) => ({ ...p, isInterstate: e.target.checked }))}
                  className="rounded border-gray-300"
                />
                Interstate (IGST)
              </label>
            </div>
          </div>
          <Button onClick={computeGst}>Compute</Button>
          {computeResult && (
            <div className="mt-4 grid grid-cols-3 gap-4 text-center">
              {[
                { label: 'Taxable', key: 'taxableAmount' },
                { label: computeResult.igstRate ? 'IGST' : 'CGST', key: computeResult.igstRate ? 'igstAmount' : 'cgstAmount' },
                ...(!computeResult.igstRate ? [{ label: 'SGST', key: 'sgstAmount' }] : []),
                { label: 'Total GST', key: 'totalGst' },
                { label: 'Grand Total', key: 'grandTotal' },
              ].map(({ label, key }) => (
                <div key={label} className="bg-gray-50 dark:bg-gray-700 rounded-lg p-3">
                  <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
                  <p className="font-bold text-gray-900 dark:text-gray-100">₹{Number(computeResult[key] ?? 0).toFixed(2)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
