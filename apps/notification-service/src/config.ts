import { loadConfigWithSecrets } from '@erp/config';

export interface NotificationServiceConfig {
  port: number;
  databaseUrl: string;
  redisUrl: string;
  msg91AuthKey: string;
  msg91TemplateId: string;
  sendgridApiKey: string;
  fromEmail: string;
  whatsappPhoneNumberId: string;
  whatsappAccessToken: string;
  jwtPublicKey: string;
  // CP-6 (Campaign Management Platform initiative): delivery-webhook verification secrets.
  // sendgridWebhookPublicKey: SendGrid's Ed25519 "Signed Event Webhook" public key (base64,
  // NOT the API key) — see https://www.twilio.com/docs/sendgrid/for-developers/tracking-events/getting-started-event-webhook-security-features.
  // whatsappAppSecret: Meta app secret used to verify X-Hub-Signature-256 (distinct from the
  // access token used to SEND messages).
  // msg91WebhookSecret: MSG91's delivery-report API has no cryptographic signature scheme —
  // this is a shared-secret token MSG91 is configured to echo back in the callback URL/header,
  // verified with a constant-time comparison. Weaker than the other two by provider design, not
  // by choice — documented in the CP-6 completion report.
  sendgridWebhookPublicKey: string;
  whatsappAppSecret: string;
  whatsappWebhookVerifyToken: string;
  msg91WebhookSecret: string;
}

export async function loadNotificationConfig(): Promise<NotificationServiceConfig> {
  const base = await loadConfigWithSecrets('notification-service');
  return {
    port: parseInt(process.env['NOTIFICATION_SERVICE_PORT'] ?? '3014', 10),
    databaseUrl: base.databaseUrl,
    redisUrl: base.redisUrl,
    msg91AuthKey: process.env['MSG91_AUTH_KEY'] ?? 'test_key',
    msg91TemplateId: process.env['MSG91_TEMPLATE_ID'] ?? 'test_template',
    sendgridApiKey: process.env['SENDGRID_API_KEY'] ?? 'test_key',
    fromEmail: process.env['SMTP_FROM_ADDRESS'] ?? 'noreply@erp.local',
    whatsappPhoneNumberId: process.env['WHATSAPP_PHONE_NUMBER_ID'] ?? '',
    whatsappAccessToken: process.env['WHATSAPP_ACCESS_TOKEN'] ?? '',
    jwtPublicKey: process.env['JWT_PUBLIC_KEY'] ?? '',
    sendgridWebhookPublicKey: process.env['SENDGRID_WEBHOOK_PUBLIC_KEY'] ?? '',
    whatsappAppSecret: process.env['WHATSAPP_APP_SECRET'] ?? '',
    whatsappWebhookVerifyToken: process.env['WHATSAPP_WEBHOOK_VERIFY_TOKEN'] ?? '',
    msg91WebhookSecret: process.env['MSG91_WEBHOOK_SECRET'] ?? '',
  };
}
