import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Deep-dive companion to `settings-sso-overview`. Grounded against sso-config.routes.ts and a
// repo-wide grep for saml|oidc (zero hits outside this one file's provider enum) plus
// LoginPage.tsx (zero SSO references). This guide exists specifically to prevent a costly
// mistake: an admin configuring "real" SSO and believing their team can now log in via their
// identity provider, when no such login path exists anywhere in the codebase yet.
const tour: TourDefinition = {
  id: 'settings-sso-complete-guide',
  version: 1,
  type: 'complete',
  title: 'Single Sign-On — complete guide',
  description:
    "What's real here (encrypted config storage) versus what isn't (any actual SSO login) — and why that distinction matters before you tell your team to expect it.",
  module: 'settings',
  estimatedMinutes: 5,
  requiredPermissions: [PERMISSIONS.SSO_CONFIG_MANAGE],
  steps: [
    {
      id: 'purpose',
      route: 'settings/sso',
      title: 'What this page actually is',
      body: "A real configuration store for your identity provider's connection details — provider name, issuer URL, client ID, and a client secret that's genuinely encrypted at rest, never returned to the browser after you save it.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.SSO_CONFIG_MANAGE,
    },
    {
      id: 'the-real-gap',
      route: 'settings/sso',
      title: 'No login integration consumes this configuration',
      body: 'This is the single most important thing to understand: saving a config here, even with "Enable SSO login" checked, does not add an SSO option to the login page. There is no SAML assertion handler, no OIDC redirect/callback route, nothing in auth-service that reads this table to authenticate anyone. It is config storage with no consumer yet.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.SSO_CONFIG_MANAGE,
      calloutTitle: 'Business impact',
      calloutVariant: 'warning',
    },
    {
      id: 'providers-supported',
      route: 'settings/sso',
      title: 'What you can configure',
      body: 'Okta, Azure AD, Google Workspace, or a generic OIDC provider — the field set is real and provider-appropriate, ready for whenever the login integration ships.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.SSO_CONFIG_MANAGE,
    },
    {
      id: 'bypass-mfa-inert',
      route: 'settings/sso',
      title: '"Skip local MFA for SSO logins" is currently inert',
      body: "This checkbox is stored but never read anywhere in the authentication code — since there's no SSO login path at all yet, this setting has no effect either way, regardless of how it's set.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.SSO_CONFIG_MANAGE,
    },
    {
      id: 'save',
      route: 'settings/sso',
      target: '[data-tour-id="settings-sso-save-button"]',
      title: 'Save Changes',
      body: "Worth doing now if you know you'll want SSO later — you're banking the setup work. Just don't communicate to your team that SSO login is available after saving; it isn't.",
      placement: 'top',
      mode: 'informational',
      requiredPermission: PERMISSIONS.SSO_CONFIG_MANAGE,
    },
    {
      id: 'remove',
      route: 'settings/sso',
      title: 'Remove SSO',
      body: 'A genuine hard delete, not a disable — the stored config, including the encrypted secret, is fully gone. You would need to re-enter everything from scratch to reconfigure.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.SSO_CONFIG_MANAGE,
    },
    {
      id: 'best-practices',
      route: 'settings/sso',
      title: 'Best practices',
      body: 'Set expectations correctly with your team.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.SSO_CONFIG_MANAGE,
      calloutTitle: 'Best practices',
      calloutVariant: 'success',
      businessImpact: [
        'Don\'t announce SSO as "live" to your team based on this page alone — verify with your account contact whether the login integration has shipped.',
        "If you're setting this up in advance, keep a record of where you got the issuer URL/client ID from, since there's no way to re-view the secret later.",
        'Treat this as preparation, not activation.',
      ],
    },
  ],
};

export default tour;
