import { useQuery } from '@tanstack/react-query';
import type { Control, FieldErrors, UseFormRegister, UseFormSetValue } from 'react-hook-form';
import { useWatch } from 'react-hook-form';
import { locationApi } from '../../../api/endpoints';
import type { Country, State } from '../../../api/endpoints';
import { Input } from '../../../components/ui/Input';
import type { CustomerFormInput } from './customer.schema';

interface CustomerFormProps {
  register: UseFormRegister<CustomerFormInput>;
  control: Control<CustomerFormInput>;
  setValue: UseFormSetValue<CustomerFormInput>;
  errors: FieldErrors<CustomerFormInput>;
}

const selectClassName = 'h-10 w-full rounded border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none transition-colors focus:border-blue-300 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-gray-50';
const selectLabelClassName = 'mb-1 block text-sm text-gray-600';
const sectionClassName = 'border-t border-gray-200 pt-5';
const sectionHeaderClassName = 'mb-4 flex items-center justify-between';

const optionName = (option: Country | State) => option.name || ('stateName' in option ? option.stateName : undefined) || ('countryName' in option ? option.countryName : undefined) || `#${option.id}`;

type AddressKey = 'billingAddress' | 'shippingAddress';

interface AddressFieldsProps extends CustomerFormProps {
  addressKey: AddressKey;
  countries: Country[];
  countriesLoading: boolean;
}

const AddressFields = ({ addressKey, register, control, setValue, errors, countries, countriesLoading }: AddressFieldsProps) => {
  const title = addressKey === 'billingAddress' ? 'Billing Address' : 'Shipping Address';
  const addressErrors = errors[addressKey];
  const countryId = Number(useWatch({ control, name: `${addressKey}.countryId` }) || 0);
  const statesQuery = useQuery({
    queryKey: ['states', countryId],
    queryFn: () => locationApi.getStates(countryId),
    enabled: countryId > 0,
  });
  const states = statesQuery.data?.data || [];
  const countryField = register(`${addressKey}.countryId`, { setValueAs: Number });
  const stateField = register(`${addressKey}.stateId`, { setValueAs: Number });

  return (
    <section className={sectionClassName}>
      <div className={sectionHeaderClassName}>
        <h3 className="text-base font-semibold text-gray-900">{title}</h3>
        <span className="text-xs font-medium text-gray-500">Optional</span>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Input label="Address Line 1" placeholder="Enter address line 1" error={addressErrors?.addressLine1?.message} {...register(`${addressKey}.addressLine1`)} />
        <Input label="Address Line 2" placeholder="Enter address line 2" error={addressErrors?.addressLine2?.message} {...register(`${addressKey}.addressLine2`)} />
        <Input label="City" placeholder="Enter city" error={addressErrors?.city?.message} {...register(`${addressKey}.city`)} />
        <Input label="Pincode" placeholder="Enter pincode" error={addressErrors?.pincode?.message} {...register(`${addressKey}.pincode`)} />
        <div>
          <label className={selectLabelClassName}>Country</label>
          <select
            className={selectClassName}
            disabled={countriesLoading}
            {...countryField}
            onChange={(event) => {
              countryField.onChange(event);
              setValue(`${addressKey}.stateId`, 0, { shouldDirty: true, shouldValidate: true });
            }}
          >
            <option value={0}>{countriesLoading ? 'Loading countries...' : 'Select country'}</option>
            {countries.map((country) => <option key={country.id} value={country.id}>{optionName(country)}</option>)}
          </select>
          {addressErrors?.countryId?.message && <p className="mt-1 text-sm text-red-600">{addressErrors.countryId.message}</p>}
        </div>
        <div>
          <label className={selectLabelClassName}>State</label>
          <select className={selectClassName} disabled={!countryId || statesQuery.isLoading} {...stateField}>
            <option value={0}>{!countryId ? 'Select country first' : statesQuery.isLoading ? 'Loading states...' : 'Select state'}</option>
            {states.map((state) => <option key={state.id} value={state.id}>{optionName(state)}</option>)}
          </select>
          {addressErrors?.stateId?.message && <p className="mt-1 text-sm text-red-600">{addressErrors.stateId.message}</p>}
        </div>
      </div>
    </section>
  );
};

export const CustomerForm = ({ register, control, setValue, errors }: CustomerFormProps) => {
  const countriesQuery = useQuery({
    queryKey: ['countries'],
    queryFn: locationApi.getCountries,
  });
  const countries = countriesQuery.data?.data || [];
  const mobileField = register('mobile');

  return (
  <div className="space-y-6">
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Input label="First Name *" placeholder="Enter first name" error={errors.firstName?.message} {...register('firstName')} />
      <Input label="Last Name *" placeholder="Enter last name" error={errors.lastName?.message} {...register('lastName')} />
      <Input label="Email" type="email" placeholder="Enter email address" error={errors.email?.message} {...register('email')} />
      <Input label="Phone" type="tel" placeholder="Enter phone number" error={errors.phone?.message} {...register('phone')} />
      <Input
        label="Mobile *"
        type="tel"
        placeholder="Enter mobile number"
        error={errors.mobile?.message}
        {...mobileField}
        onChange={(event) => {
          mobileField.onChange(event);
          setValue('whatsappNo', event.target.value, { shouldDirty: true, shouldValidate: Boolean(errors.whatsappNo) });
        }}
      />
      <Input label="WhatsApp Number *" type="tel" placeholder="Enter WhatsApp number" error={errors.whatsappNo?.message} {...register('whatsappNo')} />
      <Input label="GST Number" placeholder="Enter GST number" error={errors.gstNumber?.message} {...register('gstNumber', { setValueAs: (value) => value.toUpperCase() })} />
      <Input label="PAN Number" placeholder="Enter PAN number" error={errors.panNumber?.message} {...register('panNumber', { setValueAs: (value) => value.toUpperCase() })} />
      <Input label="Credit Limit" inputMode="decimal" placeholder="0.00" error={errors.creditLimit?.message} {...register('creditLimit')} />
      <Input label="Opening Balance" inputMode="decimal" placeholder="0.00" error={errors.openingBalance?.message} {...register('openingBalance')} />
      <div>
        <label className={selectLabelClassName}>Opening Balance Type</label>
        <select className={selectClassName} {...register('openingBalanceType')}>
          <option value="">Select balance type</option><option value="RECEIVABLE">Receivable</option><option value="PAYABLE">Payable</option>
        </select>
      </div>
      <label className="flex items-center gap-2 self-end pb-2 text-sm text-gray-700"><input type="checkbox" className="h-4 w-4" {...register('isWholesale')} />Wholesale Customer</label>
    </div>

    {(['billingAddress', 'shippingAddress'] as const).map((addressKey) => {
      return (
        <AddressFields
          key={addressKey}
          addressKey={addressKey}
          register={register}
          control={control}
          setValue={setValue}
          errors={errors}
          countries={countries}
          countriesLoading={countriesQuery.isLoading}
        />
      );
    })}
  </div>
  );
};
