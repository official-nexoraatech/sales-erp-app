import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Upload } from 'lucide-react';
import { locationApi } from '../../api/endpoints';
import type { Country, OrganizationAddress, UpdateOrganizationRequest, State } from '../../api/endpoints';

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
const optionName = (option: Country | State) => option.name || ('stateName' in option ? option.stateName : undefined) || ('countryName' in option ? option.countryName : undefined) || `#${option.id}`;

export const OrganizationForm: React.FC<OrganizationFormProps> = ({
  form,
  onChange,
  onAddressChange,
  logoFile,
  onLogoFileChange,
  showLogoUpload = false,
}) => {
  const countryId = Number(form.address.countryId || 0);
  const countries = useQuery({ queryKey: ['countries'], queryFn: locationApi.getCountries });
  const states = useQuery({
    queryKey: ['states', countryId],
    queryFn: () => locationApi.getStates(countryId),
    enabled: countryId > 0,
  });

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
        Country
        <select
          className={`${inputClass} mt-1`}
          value={form.address.countryId}
          disabled={countries.isLoading}
          onChange={(event) => {
            onAddressChange('countryId', Number(event.target.value));
            onAddressChange('stateId', 0);
          }}
        >
          <option value={0}>{countries.isLoading ? 'Loading countries...' : 'Select country'}</option>
          {(countries.data?.data || []).map((country) => <option key={country.id} value={country.id}>{optionName(country)}</option>)}
        </select>
      </label>
      <label className="text-sm text-gray-600">
        State
        <select
          className={`${inputClass} mt-1`}
          value={form.address.stateId}
          disabled={!countryId || states.isLoading}
          onChange={(event) => onAddressChange('stateId', Number(event.target.value))}
        >
          <option value={0}>{!countryId ? 'Select country first' : states.isLoading ? 'Loading states...' : 'Select state'}</option>
          {(states.data?.data || []).map((state) => <option key={state.id} value={state.id}>{optionName(state)}</option>)}
        </select>
      </label>
      <label className="text-sm text-gray-600 md:col-span-2">
        Description
        <textarea className={`${textareaClass} mt-1`} value={form.description} onChange={(event) => onChange('description', event.target.value)} />
      </label>
    </div>
  );
};
