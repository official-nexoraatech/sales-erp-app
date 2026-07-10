import { loadConfigWithSecrets } from '@erp/config';

export interface NotificationServiceConfig {
  port: number;
  databaseUrl: string;
  msg91AuthKey: string;
  msg91TemplateId: string;
  sendgridApiKey: string;
  fromEmail: string;
  whatsappPhoneNumberId: string;
  whatsappAccessToken: string;
  jwtPublicKey: string;
}

export async function loadNotificationConfig(): Promise<NotificationServiceConfig> {
  const base = await loadConfigWithSecrets('notification-service');
  return {
    port: parseInt(process.env['NOTIFICATION_SERVICE_PORT'] ?? '3014', 10),
    databaseUrl: base.databaseUrl,
    msg91AuthKey: process.env['MSG91_AUTH_KEY'] ?? 'test_key',
    msg91TemplateId: process.env['MSG91_TEMPLATE_ID'] ?? 'test_template',
    sendgridApiKey: process.env['SENDGRID_API_KEY'] ?? 'test_key',
    fromEmail: process.env['SMTP_FROM_ADDRESS'] ?? 'noreply@erp.local',
    whatsappPhoneNumberId: process.env['WHATSAPP_PHONE_NUMBER_ID'] ?? '',
    whatsappAccessToken: process.env['WHATSAPP_ACCESS_TOKEN'] ?? '',
    jwtPublicKey: process.env['JWT_PUBLIC_KEY'] ?? '',
  };
}
