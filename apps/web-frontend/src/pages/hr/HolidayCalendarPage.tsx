import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { holidayApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPErrorBoundary from '../../components/erp/ERPErrorBoundary.js';
import { ERPTableSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import Button from '../../components/ui/Button.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';
import Badge from '../../components/ui/Badge.js';
import Modal from '../../components/ui/Modal.js';

interface Holiday {
  id: string;
  name: string;
  holidayDate: string;
  holidayType: 'NATIONAL' | 'STATE' | 'OPTIONAL';
  branchId: number | null;
}

const TYPE_VARIANT: Record<string, 'default' | 'info' | 'warning'> = {
  NATIONAL: 'info',
  STATE: 'warning',
  OPTIONAL: 'default',
};

export default function HolidayCalendarPage() {
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const [year, setYear] = useState(new Date().getFullYear());
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState('');
  const [holidayDate, setHolidayDate] = useState('');
  const [holidayType, setHolidayType] = useState<'NATIONAL' | 'STATE' | 'OPTIONAL'>('NATIONAL');

  const { data, isLoading } = useQuery({
    queryKey: ['holidays', year],
    queryFn: () => holidayApi.list(year),
  });

  const holidays: Holiday[] = (data?.content as Holiday[]) ?? [];

  const createMutation = useMutation({
    mutationFn: () => holidayApi.create({ name, holidayDate, holidayType }),
    onSuccess: () => {
      toast.success('Holiday added');
      qc.invalidateQueries({ queryKey: ['holidays'] });
      setAddOpen(false);
      setName('');
      setHolidayDate('');
      setHolidayType('NATIONAL');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => holidayApi.delete(id),
    onSuccess: () => {
      toast.success('Holiday removed');
      qc.invalidateQueries({ queryKey: ['holidays'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const seedMutation = useMutation({
    mutationFn: () => holidayApi.seed(),
    onSuccess: (res) => {
      toast.success(`Seeded ${res.seeded ?? 0} holidays for 2026-27`);
      qc.invalidateQueries({ queryKey: ['holidays'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const canManage = hasPermission(PERMISSIONS.HR_MANAGE);

  return (
    <ERPErrorBoundary>
      <div>
        <ERPPageHeader
          variant="list"
          title="Holiday Calendar"
          subtitle="Manage public and company holidays by year."
          actions={
            <div className="flex gap-2">
              <div className="flex items-center gap-2">
                <label className="text-sm text-secondary">Year</label>
                <Input
                  type="number"
                  value={year}
                  onChange={(e) => setYear(Number(e.target.value))}
                  className="w-24"
                />
              </div>
              {canManage && (
                <>
                  <Button variant="secondary" onClick={() => seedMutation.mutate()} loading={seedMutation.isPending}>
                    Seed 2026-27
                  </Button>
                  <Button onClick={() => setAddOpen(true)}>+ Add Holiday</Button>
                </>
              )}
            </div>
          }
        />

        {isLoading ? (
          <ERPTableSkeleton rows={5} cols={4} />
        ) : holidays.length === 0 ? (
          <ERPEmptyState
            type="no-data"
            title={`No holidays found for ${year}`}
            description="Add a holiday or seed the default calendar for this year."
            {...(canManage ? { action: { label: '+ Add Holiday', onClick: () => setAddOpen(true) } } : {})}
          />
        ) : (
          <table className="w-full text-sm bg-surface-card rounded-xl border border-default overflow-hidden">
            <thead className="bg-surface-subtle">
              <tr className="text-left text-xs uppercase text-secondary">
                <th className="px-4 py-3">Holiday Name</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Branch</th>
                {canManage && <th className="px-4 py-3"></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-default">
              {holidays.map((h) => (
                <tr key={h.id}>
                  <td className="px-4 py-3 font-medium text-primary">{h.name}</td>
                  <td className="px-4 py-3">{h.holidayDate}</td>
                  <td className="px-4 py-3">
                    <Badge variant={TYPE_VARIANT[h.holidayType] ?? 'default'}>{h.holidayType}</Badge>
                  </td>
                  <td className="px-4 py-3 text-secondary">{h.branchId ? `Branch ${h.branchId}` : 'All Branches'}</td>
                  {canManage && (
                    <td className="px-4 py-3 text-right">
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => deleteMutation.mutate(h.id)}
                        loading={deleteMutation.isPending}
                      >
                        Remove
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add Holiday" size="sm">
          <div className="space-y-4">
            <Input label="Holiday Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Diwali" />
            <Input label="Date" type="date" value={holidayDate} onChange={(e) => setHolidayDate(e.target.value)} />
            <Select label="Type" value={holidayType} onChange={(e) => setHolidayType(e.target.value as 'NATIONAL' | 'STATE' | 'OPTIONAL')}>
              <option value="NATIONAL">National</option>
              <option value="STATE">State</option>
              <option value="OPTIONAL">Optional</option>
            </Select>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="secondary" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button onClick={() => createMutation.mutate()} loading={createMutation.isPending} disabled={!name || !holidayDate}>
                Add
              </Button>
            </div>
          </div>
        </Modal>
      </div>
    </ERPErrorBoundary>
  );
}
