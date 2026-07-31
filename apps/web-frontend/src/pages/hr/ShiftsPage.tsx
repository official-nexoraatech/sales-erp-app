import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { attendanceApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPErrorBoundary from '../../components/erp/ERPErrorBoundary.js';
import { ERPTableSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import Button from '../../components/ui/Button.js';
import Input from '../../components/ui/Input.js';
import Checkbox from '../../components/ui/Checkbox.js';
import Badge from '../../components/ui/Badge.js';

interface Shift {
  id: number;
  name: string;
  startTime: string;
  endTime: string;
  gracePeriodMinutes: number;
  halfDayHours: string;
  standardHours: string;
  isDefault: boolean;
}

export default function ShiftsPage() {
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canManage = hasPermission(PERMISSIONS.ATTENDANCE_MARK);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('18:00');
  const [gracePeriodMinutes, setGracePeriodMinutes] = useState('15');
  const [halfDayHours, setHalfDayHours] = useState('4');
  const [standardHours, setStandardHours] = useState('8');
  const [isDefault, setIsDefault] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['shifts'],
    queryFn: () => attendanceApi.shifts(),
  });
  const shifts: Shift[] = ((data as Record<string, unknown>)?.content as Shift[]) ?? [];

  const createMutation = useMutation({
    mutationFn: () =>
      attendanceApi.createShift({
        name,
        startTime,
        endTime,
        gracePeriodMinutes: parseInt(gracePeriodMinutes, 10),
        halfDayHours: parseFloat(halfDayHours),
        standardHours: parseFloat(standardHours),
        isDefault,
      }),
    onSuccess: () => {
      toast.success('Shift created');
      setShowForm(false);
      setName('');
      qc.invalidateQueries({ queryKey: ['shifts'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <ERPErrorBoundary>
      <div>
        <ERPPageHeader
          variant="list"
          title="Shifts"
          subtitle="Define working shifts — standard hours drive overtime calculation, grace period drives late detection."
          actions={
            canManage ? (
              <Button onClick={() => setShowForm((v) => !v)}>
                {showForm ? 'Cancel' : '+ New Shift'}
              </Button>
            ) : undefined
          }
        />

        {showForm && (
          <div className="mb-6 p-4 rounded-xl border border-default bg-surface-card grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Input label="Shift Name" value={name} onChange={(e) => setName(e.target.value)} />
            <Input
              label="Start Time"
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            />
            <Input
              label="End Time"
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
            />
            <Input
              label="Grace Period (minutes)"
              type="number"
              value={gracePeriodMinutes}
              onChange={(e) => setGracePeriodMinutes(e.target.value)}
            />
            <Input
              label="Half Day Hours"
              type="number"
              step="0.5"
              value={halfDayHours}
              onChange={(e) => setHalfDayHours(e.target.value)}
            />
            <Input
              label="Standard Hours"
              type="number"
              step="0.5"
              value={standardHours}
              onChange={(e) => setStandardHours(e.target.value)}
            />
            <div className="sm:col-span-3 flex items-center justify-between">
              <Checkbox
                label="Set as default shift"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
              />
              <Button
                disabled={!name || createMutation.isPending}
                onClick={() => createMutation.mutate()}
              >
                {createMutation.isPending ? 'Saving…' : 'Create Shift'}
              </Button>
            </div>
          </div>
        )}

        {isLoading ? (
          <ERPTableSkeleton rows={4} cols={5} />
        ) : shifts.length === 0 ? (
          <ERPEmptyState
            type="no-data"
            title="No shifts configured yet"
            description="Create a shift to assign it to employees and drive attendance/overtime calculation."
            {...(canManage
              ? { action: { label: '+ New Shift', onClick: () => setShowForm(true) } }
              : {})}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm bg-surface-card rounded-xl border border-default overflow-hidden">
              <thead className="bg-surface-subtle">
                <tr className="text-left text-xs uppercase text-secondary">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Timing</th>
                  <th className="px-4 py-3">Grace Period</th>
                  <th className="px-4 py-3">Half Day</th>
                  <th className="px-4 py-3">Standard Hours</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-default">
                {shifts.map((s) => (
                  <tr key={s.id}>
                    <td className="px-4 py-3 font-medium text-primary">{s.name}</td>
                    <td className="px-4 py-3">
                      {s.startTime} – {s.endTime}
                    </td>
                    <td className="px-4 py-3">{s.gracePeriodMinutes} min</td>
                    <td className="px-4 py-3">{s.halfDayHours} hrs</td>
                    <td className="px-4 py-3">{s.standardHours} hrs</td>
                    <td className="px-4 py-3 text-right">
                      {s.isDefault && <Badge variant="info">Default</Badge>}
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
