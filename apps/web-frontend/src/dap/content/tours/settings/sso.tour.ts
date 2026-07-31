import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Major correction: the previous "Test the SSO login flow" step described a feature that
// doesn't exist. Grounded against sso-config.routes.ts and a repo-wide grep for saml/oidc — the
// only hits anywhere in the backend are this one config-CRUD file's provider enum. There is no
// SAML/OIDC redirect handler, no /auth/sso/* route, and no "Sign in with SSO" option on the
// actual login page. The product's own marketing copy is honest about this
// (featureDetails.ts: "the full interactive login handshake is on our roadmap, not yet live").
const tour: TourDefinition = {
  id: 'settings-sso-overview',
  version: 1,
  type: 'quick',
  title: 'Single Sign-On — quick overview',
  description:
    "Store your identity provider's connection details in advance — the login integration itself isn't live yet.",
  module: 'settings',
  estimatedMinutes: 2,
  requiredPermissions: [PERMISSIONS.SSO_CONFIG_MANAGE],
  steps: [
    {
      id: 'intro',
      route: 'settings/sso',
      title: 'Single Sign-On',
      body: 'This page stores real, validated configuration — provider, issuer URL, client ID, and an encrypted client secret. It does not yet enable an actual SSO sign-in on the login page.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.SSO_CONFIG_MANAGE,
    },
    {
      id: 'no-login-path',
      route: 'settings/sso',
      title: 'There is no working SSO login path today',
      body: 'No SAML or OIDC handshake exists anywhere in the platform yet, and there\'s no "Sign in with SSO" option on the login screen. Saving a configuration here — even with "Enable SSO login" checked — has no effect on how your team actually logs in right now.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.SSO_CONFIG_MANAGE,
      calloutTitle: 'Common mistake',
      calloutVariant: 'warning',
    },
    {
      id: 'configure-sso',
      route: 'settings/sso',
      target: '[data-tour-id="settings-sso-save-button"]',
      title: 'Save your identity provider details',
      body: "Useful to configure now so it's ready once the login integration ships — think of this as preparing credentials in advance, not activating anything today.",
      placement: 'top',
      mode: 'informational',
      requiredPermission: PERMISSIONS.SSO_CONFIG_MANAGE,
    },
    {
      id: 'remove-sso',
      route: 'settings/sso',
      title: 'Remove SSO',
      body: "A genuine hard delete of the stored configuration (not just disabling it) — you'll need to re-enter everything, including a new client secret, if you set it up again later.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.SSO_CONFIG_MANAGE,
    },
  ],
};

export default tour;
