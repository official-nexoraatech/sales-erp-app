import type { FieldErrors, UseFormRegister, UseFormSetValue } from 'react-hook-form';
import { Input } from '../../../components/ui/Input';
import { Textarea } from '../../../components/ui/Textarea';
import type { CarrierFormData } from './carrier.schema';

interface CarrierFormProps {
  register: UseFormRegister<CarrierFormData>;
  setValue: UseFormSetValue<CarrierFormData>;
  errors: FieldErrors<CarrierFormData>;
}

export const CarrierForm = ({ register, setValue, errors }: CarrierFormProps) => {
  const mobileField = register('mobile');

  return (
    <div className="grid grid-cols-1 gap-x-4 gap-y-5 md:grid-cols-2">
      <Input label="Name *" placeholder="Enter carrier name" error={errors.name?.message} {...register('name')} />
      <Input label="Email" type="email" placeholder="Enter email" error={errors.email?.message} {...register('email')} />
      <Input
        label="Mobile"
        type="tel"
        placeholder="Enter mobile number"
        error={errors.mobile?.message}
        {...mobileField}
        onChange={(event) => {
          mobileField.onChange(event);
          setValue('whatsappNo', event.target.value, { shouldDirty: true, shouldValidate: Boolean(errors.whatsappNo) });
        }}
      />
      <Input label="WhatsApp Number" type="tel" placeholder="Enter WhatsApp number" error={errors.whatsappNo?.message} {...register('whatsappNo')} />
      <div>
        <label className="mb-1 block text-sm text-gray-600">Status</label>
        <select className="h-10 w-full rounded border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none transition-colors focus:border-blue-300 focus:ring-2 focus:ring-blue-100" {...register('status')}>
          <option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option>
        </select>
      </div>
      <Textarea label="Address" rows={3} placeholder="Enter address" error={errors.address?.message} {...register('address')} />
      <Textarea label="Note" rows={3} placeholder="Enter note" error={errors.note?.message} {...register('note')} />
    </div>
  );
};
