import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle2, Gift } from 'lucide-react';
import PublicLayout from './PublicLayout.js';
import SEO from '../../components/marketing/SEO.js';
import Input from '../../components/ui/Input.js';
import Button from '../../components/ui/Button.js';
import { referralApi } from '../../api/endpoints.js';
import {
  referralRedeemFormSchema,
  type ReferralRedeemFormData,
} from '../../schemas/referral.schema.js';

// A lightweight per-browser correlation signal for the backend's device/address fraud check —
// not a real device fingerprint (no such mechanism exists anywhere in this codebase yet, per
// this feature's own research), just a persisted random id so repeated redemption attempts from
// the same browser are recognizable as such.
function getOrCreateDeviceId(): string {
  const KEY = 'referralDeviceId';
  const existing = window.localStorage.getItem(KEY);
  if (existing) return existing;
  const created = crypto.randomUUID();
  window.localStorage.setItem(KEY, created);
  return created;
}

// CRM-ROADMAP Phase 2, Feature 4 — the public landing page a shared referral link redirects to
// (GET /r/:code on sales-service tracks the click, then redirects here with the code as a path
// segment — never a client-supplied redirect target, same open-redirect-safe shape as
// link-tracking.routes.ts's own click route). Same public/honeypot precedent as
// LeadCapturePage.tsx, since this is also an unauthenticated write endpoint.
export default function ReferralLandingPage() {
  const { code } = useParams<{ code: string }>();
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ReferralRedeemFormData>({ resolver: zodResolver(referralRedeemFormSchema) });

  async function onSubmit(data: ReferralRedeemFormData) {
    setSubmitError(null);
    try {
      await referralApi.redeem({
        code,
        refereeName: data.refereeName,
        refereePhone: data.refereePhone,
        hp: data.hp,
        deviceId: getOrCreateDeviceId(),
      });
      setSubmitted(true);
    } catch (err) {
      setSubmitError(
        err instanceof Error && err.message
          ? err.message
          : 'Something went wrong — please try again.'
      );
    }
  }

  if (!code) {
    return (
      <PublicLayout>
        <div className="py-20 text-center text-secondary">
          This referral link is not configured correctly.
        </div>
      </PublicLayout>
    );
  }

  return (
    <PublicLayout>
      <SEO
        title="You've been referred!"
        description="Claim your referral reward."
        path={`/refer/${code}`}
      />
      <section className="py-20">
        <div className="mx-auto max-w-xl px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-10">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary-subtle mb-4">
              <Gift className="h-6 w-6 text-brand" />
            </div>
            <h1 className="font-display font-semibold text-display-sm text-primary">
              You&apos;ve been referred!
            </h1>
            <p className="mt-3 text-secondary">
              Enter your details below and you&apos;ll both earn a reward once you make your first
              purchase.
            </p>
          </div>

          {submitted ? (
            <div className="rounded-2xl border border-default bg-surface-card p-8 text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-success-bg mb-4">
                <CheckCircle2 className="h-6 w-6 text-success" />
              </div>
              <h2 className="text-lg font-bold text-primary">You&apos;re all set</h2>
              <p className="mt-2 text-sm text-secondary">
                Visit us and make a purchase — your reward will be credited automatically.
              </p>
            </div>
          ) : (
            <form
              onSubmit={handleSubmit(onSubmit)}
              className="rounded-2xl border border-default bg-surface-card p-8 space-y-4"
            >
              <Input
                label="Your name"
                {...register('refereeName')}
                error={errors.refereeName?.message}
              />
              <Input
                label="Phone"
                {...register('refereePhone')}
                error={errors.refereePhone?.message}
              />
              {/* Honeypot — hidden from sighted users and off the tab order. */}
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
                Claim my referral
              </Button>
            </form>
          )}
        </div>
      </section>
    </PublicLayout>
  );
}
