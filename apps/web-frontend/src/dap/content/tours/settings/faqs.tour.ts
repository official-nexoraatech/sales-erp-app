import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Major correction: this page's own description previously said "shown to your team" — that's
// wrong on two counts. Grounded against faq.routes.ts's own top comment ("Public marketing site
// FAQ content management. Global (no tenant_id) — this is platform content") and
// FAQSection.tsx (the public marketing site component that actually renders these rows).
// (1) These FAQs are published to the PUBLIC marketing website, not your team's in-app Help
// Panel — the Help Panel reads from a separate, hardcoded content file entirely. (2) This page
// requires PLATFORM_CONTENT_MANAGE, a platform-operator-only permission — not even a tenant
// Owner/Admin can reach it in practice.
const tour: TourDefinition = {
  id: 'settings-faqs-overview',
  version: 1,
  type: 'quick',
  title: 'FAQ Management — quick overview',
  description: "Manage the public marketing website's FAQ content — not your team's in-app help.",
  module: 'settings',
  estimatedMinutes: 2,
  requiredPermissions: [PERMISSIONS.PLATFORM_CONTENT_MANAGE],
  steps: [
    {
      id: 'intro',
      route: 'settings/faqs',
      title: 'FAQ Management',
      body: 'This edits the FAQ accordion on the public marketing website (the one prospective customers see before signing up) — it does not feed the in-app Help Panel your own team uses, which reads from separate, built-in content.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PLATFORM_CONTENT_MANAGE,
    },
    {
      id: 'platform-operator-only',
      route: 'settings/faqs',
      title: 'Platform-operator only',
      body: "This page requires a platform-level permission that no tenant role — including Owner and Admin — is ever granted. If you're a regular tenant admin, you likely can't reach this page at all; it's genuinely for platform staff managing the marketing site.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PLATFORM_CONTENT_MANAGE,
    },
    {
      id: 'add-faq',
      route: 'settings/faqs',
      target: '[data-tour-id="settings-faqs-create-button"]',
      title: 'Add an FAQ entry',
      body: 'Category (free text — matched by exact string, so a typo silently creates a duplicate section), question, answer, and a Published checkbox. Only Published entries appear on the public site.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PLATFORM_CONTENT_MANAGE,
    },
  ],
};

export default tour;
