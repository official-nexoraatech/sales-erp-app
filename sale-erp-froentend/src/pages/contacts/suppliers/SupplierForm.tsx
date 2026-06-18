import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CircleDollarSign, MapPin } from 'lucide-react';
import type { FieldErrors, UseFormRegister, UseFormSetValue } from 'react-hook-form';
import { locationApi } from '../../../api/endpoints';
import type { Country, State } from '../../../api/endpoints';
import { Input } from '../../../components/ui/Input';
import { Textarea } from '../../../components/ui/Textarea';
import type { SupplierFormInput } from './supplier.schema';

interface SupplierFormProps {
  register: UseFormRegister<SupplierFormInput>;
  setValue: UseFormSetValue<SupplierFormInput>;
  errors: FieldErrors<SupplierFormInput>;
}

const selectClassName = 'h-10 w-full rounded border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none transition-colors focus:border-blue-300 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-gray-50';

const optionName = (option: Country | State) => option.name || ('stateName' in option ? option.stateName : undefined) || ('countryName' in option ? option.countryName : undefined) || `#${option.id}`;

export const SupplierForm = ({ register, setValue, errors }: SupplierFormProps) => {
  const [activeTab, setActiveTab] = useState<'address' | 'credit'>('address');
  const [countryId, setCountryId] = useState(0);
  const countries = useQuery({ queryKey: ['countries'], queryFn: locationApi.getCountries });
  const states = useQuery({
    queryKey: ['states', countryId],
    queryFn: () => locationApi.getStates(countryId),
    enabled: countryId > 0,
  });

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-x-4 gap-y-5 md:grid-cols-2">
        <div className="md:col-span-2">
          <Input label="Company Name" placeholder="Enter company name" error={errors.companyName?.message} {...register('companyName')} />
        </div>
        <Input label="First Name *" placeholder="Enter first name" error={errors.firstName?.message} {...register('firstName')} />
        <Input label="Last Name *" placeholder="Enter last name" error={errors.lastName?.message} {...register('lastName')} />
        <Input label="Email" type="email" placeholder="Enter email address" error={errors.email?.message} {...register('email')} />
        <Input label="Phone" type="tel" placeholder="Enter phone number" error={errors.phone?.message} {...register('phone')} />
        <Input label="Mobile *" type="tel" placeholder="Enter mobile number" error={errors.mobile?.message} {...register('mobile')} />
        <Input label="WhatsApp Number" type="tel" placeholder="Enter WhatsApp number" error={errors.whatsappNo?.message} {...register('whatsappNo')} />
        <Input label="Tax Number" placeholder="Enter GST number" error={errors.gstNumber?.message} {...register('gstNumber', { setValueAs: (value) => value.toUpperCase() })} />
        <div>
          <label className="mb-1 block text-sm text-gray-600">Country</label>
          <select
            className={selectClassName}
            value={countryId}
            disabled={countries.isLoading}
            onChange={(event) => {
              setCountryId(Number(event.target.value));
              setValue('state', '', { shouldDirty: true, shouldValidate: true });
            }}
          >
            <option value={0}>{countries.isLoading ? 'Loading countries...' : 'Select country'}</option>
            {(countries.data?.data || []).map((country) => <option key={country.id} value={country.id}>{optionName(country)}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm text-gray-600">State Name</label>
          <select className={selectClassName} disabled={!countryId || states.isLoading} {...register('state')}>
            <option value="">{!countryId ? 'Select country first' : states.isLoading ? 'Loading states...' : 'Select state'}</option>
            {(states.data?.data || []).map((state) => <option key={state.id} value={optionName(state)}>{optionName(state)}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm text-gray-600">Status</label>
          <select className={selectClassName} {...register('status')}>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
        </div>
      </div>

      <label className="flex w-fit cursor-pointer items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" className="h-4 w-4 rounded border-gray-300 text-blue-600" {...register('isDefaultSupplier')} />
        Set as a default Supplier
      </label>

      <div>
        <div className="flex border-b border-gray-200">
          <button type="button" onClick={() => setActiveTab('address')} className={`flex items-center gap-2 border px-4 py-2 text-sm font-medium ${activeTab === 'address' ? '-mb-px border-green-500 border-b-white text-green-600' : 'border-transparent text-gray-500'}`}>
            <MapPin size={16} /> Address
          </button>
          <button type="button" onClick={() => setActiveTab('credit')} className={`flex items-center gap-2 border px-4 py-2 text-sm font-medium ${activeTab === 'credit' ? '-mb-px border-blue-500 border-b-white text-blue-600' : 'border-transparent text-gray-500'}`}>
            <CircleDollarSign size={16} /> Credit &amp; Balance
          </button>
        </div>

        {activeTab === 'address' ? (
          <div className="grid grid-cols-1 gap-6 pt-5 lg:grid-cols-2">
            <Textarea label="Billing Address" rows={5} placeholder="Enter billing address" error={errors.billingAddress?.message} {...register('billingAddress')} />
            <div>
              <h3 className="mb-2 text-sm font-semibold text-gray-800">Shipping Address Details</h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input label="Name" placeholder="Enter name" error={errors.shippingName?.message} {...register('shippingName')} />
                <Input label="Mobile" type="tel" placeholder="Enter mobile" error={errors.shippingMobile?.message} {...register('shippingMobile')} />
                <Input label="Email" type="email" placeholder="Enter email" error={errors.shippingEmail?.message} {...register('shippingEmail')} />
                <Input label="GSTIN/UIN" placeholder="Enter GSTIN/UIN" error={errors.shippingGstin?.message} {...register('shippingGstin')} />
                <div className="sm:col-span-2">
                  <Textarea label="Shipping Address" rows={3} placeholder="Enter shipping address" error={errors.shippingAddress?.message} {...register('shippingAddress')} />
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 pt-5 md:grid-cols-2">
            <Input label="Credit Limit" type="number" min="0" step="0.01" placeholder="0.00" error={errors.creditLimit?.message} {...register('creditLimit')} />
            <Input label="Opening Balance" type="number" min="0" step="0.01" placeholder="0.00" error={errors.openingBalance?.message} {...register('openingBalance')} />
          </div>
        )}
      </div>
    </div>
  );
};
