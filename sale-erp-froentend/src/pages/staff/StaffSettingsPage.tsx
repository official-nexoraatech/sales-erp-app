import React, { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Edit, Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { staffApi } from '../../api/endpoints';
import type { StaffSetting, StaffSettingType } from '../../api/endpoints';
import { queryClient } from '../../app/queryClient';
import { Button } from '../../components/ui/Button';
import { Loader } from '../../components/ui/Loader';
import { useConfirmation } from '../../hooks/useConfirmation';
import { employeeStatuses, inputClass, labelClass, pretty, statusClass, textareaClass } from './staffShared';

const tabs: Array<{ key: StaffSettingType; label: string }> = [
  { key: 'departments', label: 'Departments' },
  { key: 'designations', label: 'Designations' },
  { key: 'shifts', label: 'Shifts' },
  { key: 'holidays', label: 'Holidays' },
  { key: 'leaveTypes', label: 'Leave Types' },
  { key: 'salaryComponents', label: 'Salary Components' },
];

const emptySetting: Omit<StaffSetting, 'id'> = { name: '', description: '', status: 'ACTIVE' };

export const StaffSettingsPage: React.FC = () => {
  const { confirmAction, confirmationDialog } = useConfirmation();
  const [activeTab, setActiveTab] = useState<StaffSettingType>('departments');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<StaffSetting | null>(null);
  const [form, setForm] = useState<Omit<StaffSetting, 'id'>>(emptySetting);

  const settings = useQuery({ queryKey: ['staff-settings', activeTab], queryFn: () => staffApi.getSettings(activeTab) });

  const save = useMutation({
    mutationFn: () => editing ? staffApi.updateSetting(activeTab, editing.id, form) : staffApi.createSetting(activeTab, form),
    onSuccess: () => {
      toast.success(`Setting ${editing ? 'updated' : 'created'}`);
      setModalOpen(false);
      setEditing(null);
      setForm(emptySetting);
      queryClient.invalidateQueries({ queryKey: ['staff-settings', activeTab] });
      queryClient.invalidateQueries({ queryKey: ['staff-departments-options'] });
      queryClient.invalidateQueries({ queryKey: ['staff-designations-options'] });
    },
    onError: (error: any) => toast.error(error?.message || 'Failed to save setting'),
  });
  const remove = useMutation({
    mutationFn: (id: number) => staffApi.deleteSetting(activeTab, id),
    onSuccess: () => {
      toast.success('Setting deleted');
      queryClient.invalidateQueries({ queryKey: ['staff-settings', activeTab] });
    },
    onError: (error: any) => toast.error(error?.message || 'Failed to delete setting'),
  });

  const openCreate = () => {
    setEditing(null);
    setForm(emptySetting);
    setModalOpen(true);
  };
  const openEdit = (row: StaffSetting) => {
    setEditing(row);
    const { id: _id, ...payload } = row;
    setForm(payload);
    setModalOpen(true);
  };
  const submit = () => {
    if (!form.name.trim()) return toast.error('Name is required');
    save.mutate();
  };

  return (
    <div className="space-y-5">
      <div className="text-sm text-gray-500">Home &gt; Staff Management &gt; Settings</div>
      <div className="overflow-hidden rounded-lg bg-white shadow">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
          <h1 className="text-xl font-semibold text-gray-900">Staff Settings</h1>
          <Button type="button" onClick={openCreate}><Plus size={16} /> Add</Button>
        </div>

        <div className="flex flex-wrap gap-2 border-b px-5 pt-4">
          {tabs.map((tab) => (
            <button
              type="button"
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`rounded-t border px-4 py-2 text-sm font-medium ${activeTab === tab.key ? 'border-blue-500 border-b-white text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-900'}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="overflow-x-auto p-3">
          {settings.isLoading ? <div className="p-10"><Loader /></div> : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50"><tr>{['Name', 'Description', 'Status', 'Action'].map((heading) => <th key={heading} className="border p-3 text-left">{heading}</th>)}</tr></thead>
              <tbody>
                {(settings.data?.data || []).length ? settings.data?.data.map((row) => (
                  <tr key={row.id} className="border-b even:bg-gray-50">
                    <td className="border p-3 font-semibold">{row.name}</td>
                    <td className="border p-3">{row.description}</td>
                    <td className="border p-3"><span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusClass(row.status)}`}>{pretty(row.status)}</span></td>
                    <td className="border p-3"><div className="flex gap-2"><button type="button" onClick={() => openEdit(row)} className="text-orange-600"><Edit size={16} /></button><button type="button" onClick={async () => { if (await confirmAction({ title: 'Delete Setting', message: 'Delete this setting?', confirmText: 'Delete', variant: 'danger' })) remove.mutate(row.id); }} className="text-red-600"><Trash2 size={16} /></button></div></td>
                  </tr>
                )) : <tr><td colSpan={4} className="bg-gray-50 p-5 text-center">No settings found</td></tr>}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-lg overflow-hidden rounded-lg bg-white shadow-xl">
            <div className="border-b px-5 py-4"><h2 className="text-lg font-semibold">{editing ? 'Edit' : 'Create'} {tabs.find((tab) => tab.key === activeTab)?.label}</h2></div>
            <div className="space-y-4 p-5">
              <label className={labelClass}>Name<input className={`${inputClass} mt-1`} value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></label>
              <label className={labelClass}>Description<textarea className={textareaClass} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></label>
              <label className={labelClass}>Status<select className={`${inputClass} mt-1`} value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as StaffSetting['status'] }))}>{employeeStatuses.map((entry) => <option key={entry} value={entry}>{pretty(entry)}</option>)}</select></label>
            </div>
            <div className="flex justify-end gap-3 border-t bg-gray-50 p-5">
              <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>Close</Button>
              <Button type="button" isLoading={save.isPending} onClick={submit}>Submit</Button>
            </div>
          </div>
        </div>
      )}
      {confirmationDialog}
    </div>
  );
};
