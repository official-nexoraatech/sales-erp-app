import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle2 } from 'lucide-react';
import PublicLayout from './PublicLayout.js';
import SEO from '../../components/marketing/SEO.js';
import Input from '../../components/ui/Input.js';
import Button from '../../components/ui/Button.js';
import { leadApi } from '../../api/endpoints.js';
import { leadCaptureFormSchema, type LeadCaptureFormData } from '../../schemas/lead.schema.js';

// CRM-ROADMAP Phase 1, Feature 2 — the embeddable public lead-capture widget. Meant to be
// iframed into a tenant's own external marketing site with `?tenantId=<id>` baked into the
// embed URL (there's no JWT/session to derive a tenant from on a page any anonymous visitor
// can load) — same shape as ContactPage.tsx's demo-request form, but tenant-scoped instead
// of platform-global.
export default function LeadCapturePage() {
  const [searchParams] = useSearchParams();
  const tenantId = searchParams.get('tenantId');
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LeadCaptureFormData>({ resolver: zodResolver(leadCaptureFormSchema) });

  async function onSubmit(data: LeadCaptureFormData) {
    setSubmitError(null);
    try {
      await leadApi.capture({
        tenantId: Number(tenantId),
        displayName: data.displayName,
        companyName: data.companyName,
        phone: data.phone,
        email: data.email,
        notes: data.notes,
        hp: data.hp,
        source: 'WEBSITE',
      });
      setSubmitted(true);
    } catch {
      setSubmitError('Something went wrong — please try again.');
    }
  }

  if (!tenantId) {
    return (
      <PublicLayout>
        <div className="py-20 text-center text-secondary">
          This form link is not configured correctly.
        </div>
      </PublicLayout>
    );
  }

  return (
    <PublicLayout>
      <SEO
        title="Get in touch"
        description="Tell us about your business needs."
        path="/lead-capture"
      />
      <section className="py-20">
        <div className="mx-auto max-w-xl px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-10">
            <h1 className="font-display font-semibold text-display-sm text-primary">
              Get in touch
            </h1>
            <p className="mt-3 text-secondary">
              Tell us a bit about yourself and we&apos;ll reach out.
            </p>
          </div>

          {submitted ? (
            <div className="rounded-2xl border border-default bg-surface-card p-8 text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-success-bg mb-4">
                <CheckCircle2 className="h-6 w-6 text-success" />
              </div>
              <h2 className="text-lg font-bold text-primary">Thanks — we&apos;ll be in touch</h2>
              <p className="mt-2 text-sm text-secondary">
                Someone from the team will reach out soon.
              </p>
            </div>
          ) : (
            <form
              onSubmit={handleSubmit(onSubmit)}
              className="rounded-2xl border border-default bg-surface-card p-8 space-y-4"
            >
              <Input
                label="Your name"
                {...register('displayName')}
                error={errors.displayName?.message}
              />
              <Input
                label="Company"
                {...register('companyName')}
                error={errors.companyName?.message}
              />
              <Input label="Phone" {...register('phone')} error={errors.phone?.message} />
              <Input
                label="Email"
                type="email"
                {...register('email')}
                error={errors.email?.message}
              />
              {/* Honeypot — hidden from sighted users and off the tab order; a bot that fills
                  every field it finds in the DOM will populate this one, a real user never will. */}
              <div className="absolute -left-[9999px]" aria-hidden="true">
                <label htmlFor="hp">Leave this field blank</label>
                <input id="hp" type="text" tabIndex={-1} autoComplete="off" {...register('hp')} />
              </div>
              {submitError && <p className="text-sm text-danger">{submitError}</p>}
              <Button
                type="submit"
                className="w-full justify-center"
                loading={isSubmitting}
                size="lg"
              >
                Submit
              </Button>
            </form>
          )}
        </div>
      </section>
    </PublicLayout>
  );
}
