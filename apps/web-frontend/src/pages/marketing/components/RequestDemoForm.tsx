import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CheckCircle2 } from 'lucide-react';
import Input from '../../../components/ui/Input.js';
import Select from '../../../components/ui/Select.js';
import Button from '../../../components/ui/Button.js';
import { demoRequestApi } from '../../../api/endpoints.js';

const COUNTRY_CODES = [
  { value: '+91', label: 'India (+91)' },
  { value: '+1', label: 'USA (+1)' },
  { value: '+44', label: 'UK (+44)' },
  { value: '+971', label: 'UAE (+971)' },
  { value: '+other', label: 'Other' },
];

const PRODUCT_TYPES = [
  { value: 'RETAIL', label: 'Retail' },
  { value: 'DISTRIBUTION', label: 'Distribution' },
  { value: 'MANUFACTURING', label: 'Manufacturing' },
  { value: 'OTHER', label: 'Other' },
];

const schema = z.object({
  fullName: z.string().min(1, 'Required'),
  email: z.string().email('Invalid email'),
  countryCode: z.string().min(1),
  phone: z.string().min(6, 'Enter a valid contact number'),
  company: z.string().min(1, 'Required'),
  city: z.string().optional(),
  designation: z.string().optional(),
  productType: z.string().optional(),
});
type FormData = z.infer<typeof schema>;

/** The screenshot's "Request For Demo" form — the landing page's sole hero CTA. Posts to the
 * same demo_requests table the /contact page now feeds, tagged HERO_FORM so platform admins
 * can tell the two entry points apart. */
export default function RequestDemoForm() {
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema), defaultValues: { countryCode: '+91' } });

  async function onSubmit(data: FormData): Promise<void> {
    setSubmitError(null);
    try {
      await demoRequestApi.submit({
        fullName: data.fullName,
        email: data.email,
        countryCode: data.countryCode,
        phone: data.phone,
        company: data.company,
        ...(data.city ? { city: data.city } : {}),
        ...(data.designation ? { designation: data.designation } : {}),
        ...(data.productType ? { productType: data.productType } : {}),
        source: 'HERO_FORM',
      });
      setSubmitted(true);
    } catch {
      setSubmitError('Something went wrong — please try again.');
    }
  }

  if (submitted) {
    return (
      <div className="rounded-2xl border border-default bg-surface-card p-8 text-center shadow-xl">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-success-bg mb-4">
          <CheckCircle2 className="h-6 w-6 text-success" />
        </div>
        <h2 className="text-lg font-bold text-primary">Thanks — we&apos;ll be in touch</h2>
        <p className="mt-2 text-sm text-secondary">
          Our team will reach out shortly to schedule your demo.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="rounded-2xl border border-default bg-surface-card p-6 sm:p-8 space-y-4 shadow-xl"
    >
      <h2 className="font-display font-semibold text-xl text-primary">Request For Demo</h2>
      <div className="grid sm:grid-cols-2 gap-4">
        <Input
          label="Full Name"
          placeholder="Enter Your Name"
          {...register('fullName')}
          error={errors.fullName?.message}
        />
        <Input
          label="Email Id"
          type="email"
          placeholder="Enter Email Address"
          {...register('email')}
          error={errors.email?.message}
        />
      </div>
      <div>
        <span className="block text-sm font-medium text-secondary mb-1.5">Contact No</span>
        <div className="grid grid-cols-[auto_1fr] gap-2">
          <Select
            className="w-32"
            aria-label="Country code"
            options={COUNTRY_CODES}
            {...register('countryCode')}
          />
          <Input
            placeholder="Enter Contact No"
            {...register('phone')}
            error={errors.phone?.message}
          />
        </div>
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <Input
          label="Company"
          placeholder="Enter Company Name"
          {...register('company')}
          error={errors.company?.message}
        />
        <Input label="City" placeholder="Enter City Name" {...register('city')} />
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <Input label="Designation" placeholder="Enter Designation" {...register('designation')} />
        <Select
          label="Product type"
          placeholder="Select Product Type"
          options={PRODUCT_TYPES}
          {...register('productType')}
        />
      </div>
      {submitError && <p className="text-sm text-danger">{submitError}</p>}
      <Button type="submit" size="lg" className="w-full justify-center" loading={isSubmitting}>
        Book a Demo
      </Button>
    </form>
  );
}
