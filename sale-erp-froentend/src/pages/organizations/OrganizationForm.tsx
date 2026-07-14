import React from 'react';
import { Upload } from 'lucide-react';
import type { OrganizationAddress, UpdateOrganizationRequest } from '../../api/endpoints';
import { stateOptionName, useStates } from '../../hooks/useStates';

interface OrganizationFormProps {
  form: UpdateOrganizationRequest;
  onChange: <K extends keyof UpdateOrganizationRequest>(field: K, value: UpdateOrganizationRequest[K]) => void;
  onAddressChange: <K extends keyof OrganizationAddress>(field: K, value: OrganizationAddress[K]) => void;
  logoFile?: File | null;
  onLogoFileChange?: (file: File | null) => void;
  showLogoUpload?: boolean;
}

const inputClass = 'h-10 w-full rounded border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-gray-50';
const textareaClass = 'h-24 w-full rounded border border-gray-300 p-3 text-sm outline-none focus:ring-2 focus:ring-blue-100';

export const OrganizationForm: React.FC<OrganizationFormProps> = ({
  form,
  onChange,
  onAddressChange,
  logoFile,
  onLogoFileChange,
  showLogoUpload = false,
}) => {
  const { states, isLoading: statesLoading, isError: statesError } = useStates();

  return (
    <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2">
      <label className="text-sm text-gray-600">
        Name
        <input className={`${inputClass} mt-1`} value={form.name} onChange={(event) => onChange('name', event.target.value)} />
      </label>
      <label className="text-sm text-gray-600">
        Status
        <select className={`${inputClass} mt-1`} value={form.status} onChange={(event) => onChange('status', event.target.value as UpdateOrganizationRequest['status'])}>
          <option value="ACTIVE">ACTIVE</option>
          <option value="INACTIVE">INACTIVE</option>
        </select>
      </label>
      <label className="flex items-center gap-2 self-end text-sm text-gray-600">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-100"
          checked={form.isSubscribed !== false}
          onChange={(event) => onChange('isSubscribed', event.target.checked)}
        />
        Subscribed
      </label>
      <label className="text-sm text-gray-600">
        Phone
        <input className={`${inputClass} mt-1`} value={form.phone || ''} onChange={(event) => onChange('phone', event.target.value)} />
      </label>
      <label className="text-sm text-gray-600">
        GSTIN
        <input className={`${inputClass} mt-1`} value={form.gstNumber || ''} onChange={(event) => onChange('gstNumber', event.target.value.toUpperCase())} />
      </label>
      {showLogoUpload && (
        <div className="text-sm text-gray-600 md:col-span-2">
          <span>Logo Attachment</span>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded border border-gray-300 bg-white px-3 text-sm text-gray-700 hover:bg-gray-50">
              <Upload size={16} />
              Browse
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => onLogoFileChange?.(event.target.files?.[0] || null)}
              />
            </label>
            <span className="text-xs text-gray-500">{logoFile?.name || 'Allowed image files'}</span>
          </div>
        </div>
      )}
      <label className="text-sm text-gray-600">
        Address Line 1
        <input className={`${inputClass} mt-1`} value={form.address.addressLine1} onChange={(event) => onAddressChange('addressLine1', event.target.value)} />
      </label>
      <label className="text-sm text-gray-600">
        Address Line 2
        <input className={`${inputClass} mt-1`} value={form.address.addressLine2} onChange={(event) => onAddressChange('addressLine2', event.target.value)} />
      </label>
      <label className="text-sm text-gray-600">
        City
        <input className={`${inputClass} mt-1`} value={form.address.city} onChange={(event) => onAddressChange('city', event.target.value)} />
      </label>
      <label className="text-sm text-gray-600">
        Pincode
        <input className={`${inputClass} mt-1`} value={form.address.pincode} onChange={(event) => onAddressChange('pincode', event.target.value)} />
      </label>
      <label className="text-sm text-gray-600">
        State
        <select
          className={`${inputClass} mt-1`}
          value={form.address.stateId}
          disabled={statesLoading || statesError}
          onChange={(event) => onAddressChange('stateId', Number(event.target.value))}
        >
          <option value={0}>{statesLoading ? 'Loading states...' : statesError ? 'Failed to load states' : 'Select state'}</option>
          {states.map((state) => <option key={state.id} value={state.id}>{stateOptionName(state)}</option>)}
        </select>
      </label>
      <label className="text-sm text-gray-600 md:col-span-2">
        Description
        <textarea className={`${textareaClass} mt-1`} value={form.description} onChange={(event) => onChange('description', event.target.value)} />
      </label>
    </div>
  );
};
