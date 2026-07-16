import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CheckCircle2 } from 'lucide-react';
import SEO from '../../components/marketing/SEO.js';
import PublicLayout from './PublicLayout.js';
import { Textarea } from '@erp/ui';
import Input from '../../components/ui/Input.js';
import Button from '../../components/ui/Button.js';

const schema = z.object({
  name: z.string().min(1, 'Required'),
  email: z.string().email('Invalid email'),
  company: z.string().min(1, 'Required'),
  message: z.string().min(1, 'Required').max(2000),
});
type FormData = z.infer<typeof schema>;

export default function ContactPage() {
  const [submitted, setSubmitted] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  async function onSubmit() {
    // No backend lead-capture endpoint exists yet — this simply confirms receipt locally.
    // Wiring this to a real CRM/email destination is a follow-up item.
    await new Promise((resolve) => setTimeout(resolve, 400));
    setSubmitted(true);
  }

  return (
    <PublicLayout>
      <SEO
        title="Contact Sales"
        description="Talk to the NEXORAA ERP team about your business needs."
        path="/contact"
      />
      <section className="py-20">
        <div className="mx-auto max-w-xl px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-10">
            <h1 className="font-display font-semibold text-display-sm text-primary">
              Talk to Sales
            </h1>
            <p className="mt-3 text-secondary">
              Tell us about your business and we&apos;ll get back to you.
            </p>
          </div>

          {submitted ? (
            <div className="rounded-2xl border border-default bg-surface-card p-8 text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-success-bg mb-4">
                <CheckCircle2 className="h-6 w-6 text-success" />
              </div>
              <h2 className="text-lg font-bold text-primary">Thanks — we&apos;ll be in touch</h2>
              <p className="mt-2 text-sm text-secondary">
                We&apos;ve received your message and someone from our team will reach out soon.
              </p>
            </div>
          ) : (
            <form
              onSubmit={handleSubmit(onSubmit)}
              className="rounded-2xl border border-default bg-surface-card p-8 space-y-4"
            >
              <Input label="Your name" {...register('name')} error={errors.name?.message} />
              <Input
                label="Work email"
                type="email"
                {...register('email')}
                error={errors.email?.message}
              />
              <Input label="Company" {...register('company')} error={errors.company?.message} />
              <Textarea
                label="How can we help?"
                rows={4}
                {...register('message')}
                error={errors.message?.message}
              />
              <Button
                type="submit"
                className="w-full justify-center"
                loading={isSubmitting}
                size="lg"
              >
                Send message
              </Button>
            </form>
          )}
        </div>
      </section>
    </PublicLayout>
  );
}
