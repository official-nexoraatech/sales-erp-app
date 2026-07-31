import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, X } from 'lucide-react';
import { payrollApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPErrorBoundary from '../../components/erp/ERPErrorBoundary.js';
import { ERPTableSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import Button from '../../components/ui/Button.js';
import Input from '../../components/ui/Input.js';

interface Allowance {
  name: string;
  amount: number;
}

interface SalaryStructure {
  id: number;
  name: string;
  code: string;
  basicPercent: string;
  hraPercent: string;
  daPercent: string;
  allowances: Allowance[];
  isActive: boolean;
}

export default function SalaryStructuresPage() {
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canManage = hasPermission(PERMISSIONS.PAYROLL_PROCESS);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [basicPercent, setBasicPercent] = useState('50');
  const [hraPercent, setHraPercent] = useState('20');
  const [daPercent, setDaPercent] = useState('10');
  const [allowances, setAllowances] = useState<Allowance[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ['salary-structures'],
    queryFn: () => payrollApi.salaryStructures(),
  });
  const structures: SalaryStructure[] =
    ((data as Record<string, unknown>)?.content as SalaryStructure[]) ?? [];

  const createMutation = useMutation({
    mutationFn: () =>
      payrollApi.createSalaryStructure({
        name,
        code,
        basicPercent: parseFloat(basicPercent),
        hraPercent: parseFloat(hraPercent),
        daPercent: parseFloat(daPercent),
        allowances,
      }),
    onSuccess: () => {
      toast.success('Salary structure created');
      setShowForm(false);
      setName('');
      setCode('');
      setAllowances([]);
      qc.invalidateQueries({ queryKey: ['salary-structures'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const totalPercent =
    parseFloat(basicPercent || '0') + parseFloat(hraPercent || '0') + parseFloat(daPercent || '0');

  return (
    <ERPErrorBoundary>
      <div>
        <ERPPageHeader
          variant="list"
          title="Salary Structures"
          subtitle="Reusable Basic/HRA/DA templates for assigning employee salaries."
          actions={
            canManage ? (
              <Button onClick={() => setShowForm((v) => !v)}>
                {showForm ? 'Cancel' : '+ New Structure'}
              </Button>
            ) : undefined
          }
        />

        {showForm && (
          <div className="mb-6 p-4 rounded-xl border border-default bg-surface-card space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Input
                label="Structure Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <Input label="Code" value={code} onChange={(e) => setCode(e.target.value)} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Input
                label="Basic %"
                type="number"
                value={basicPercent}
                onChange={(e) => setBasicPercent(e.target.value)}
              />
              <Input
                label="HRA %"
                type="number"
                value={hraPercent}
                onChange={(e) => setHraPercent(e.target.value)}
              />
              <Input
                label="DA %"
                type="number"
                value={daPercent}
                onChange={(e) => setDaPercent(e.target.value)}
              />
            </div>
            <p className={`text-xs ${totalPercent > 100 ? 'text-danger' : 'text-secondary'}`}>
              Basic + HRA + DA = {totalPercent}% of CTC{totalPercent > 100 ? ' — exceeds 100%' : ''}
            </p>

            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-primary">
                  Other Allowances (fixed amounts)
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setAllowances((a) => [...a, { name: '', amount: 0 }])}
                >
                  <Plus size={14} className="mr-1" /> Add Allowance
                </Button>
              </div>
              {allowances.map((a, idx) => (
                <div key={idx} className="flex gap-2 mb-2">
                  <Input
                    placeholder="Allowance name (e.g. Conveyance)"
                    value={a.name}
                    onChange={(e) =>
                      setAllowances((prev) =>
                        prev.map((row, i) => (i === idx ? { ...row, name: e.target.value } : row))
                      )
                    }
                  />
                  <Input
                    type="number"
                    placeholder="Amount"
                    value={a.amount}
                    onChange={(e) =>
                      setAllowances((prev) =>
                        prev.map((row, i) =>
                          i === idx ? { ...row, amount: parseFloat(e.target.value) || 0 } : row
                        )
                      )
                    }
                    className="max-w-[140px]"
                  />
                  <button
                    type="button"
                    onClick={() => setAllowances((prev) => prev.filter((_, i) => i !== idx))}
                    className="p-2 text-secondary hover:text-danger"
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
            </div>

            <Button
              disabled={!name || !code || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? 'Saving…' : 'Create Structure'}
            </Button>
          </div>
        )}

        {isLoading ? (
          <ERPTableSkeleton rows={4} cols={5} />
        ) : structures.length === 0 ? (
          <ERPEmptyState
            type="no-data"
            title="No salary structures defined yet"
            description="Create a template to standardize Basic/HRA/DA splits across employees."
            {...(canManage
              ? { action: { label: '+ New Structure', onClick: () => setShowForm(true) } }
              : {})}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm bg-surface-card rounded-xl border border-default overflow-hidden">
              <thead className="bg-surface-subtle">
                <tr className="text-left text-xs uppercase text-secondary">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Code</th>
                  <th className="px-4 py-3 text-right">Basic %</th>
                  <th className="px-4 py-3 text-right">HRA %</th>
                  <th className="px-4 py-3 text-right">DA %</th>
                  <th className="px-4 py-3">Other Allowances</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-default">
                {structures.map((s) => (
                  <tr key={s.id}>
                    <td className="px-4 py-3 font-medium text-primary">{s.name}</td>
                    <td className="px-4 py-3 font-mono text-xs">{s.code}</td>
                    <td className="px-4 py-3 text-right">{s.basicPercent}%</td>
                    <td className="px-4 py-3 text-right">{s.hraPercent}%</td>
                    <td className="px-4 py-3 text-right">{s.daPercent}%</td>
                    <td className="px-4 py-3 text-secondary text-xs">
                      {(s.allowances ?? []).length === 0
                        ? '–'
                        : s.allowances.map((a) => `${a.name}: ${a.amount}`).join(', ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </ERPErrorBoundary>
  );
}
