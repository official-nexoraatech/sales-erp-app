import nodemailer from 'nodemailer';
import type { ChannelDeliveryParams, ChannelDeliveryResult, ChannelProvider } from './types.js';

// Appends the media asset to the HTML body — an inline <img> for images (renders directly in
// most email clients from a signed URL), a plain link for video/document since email clients
// can't play/preview those inline.
function withMedia(
  html: string,
  mediaUrl?: string,
  mediaType?: ChannelDeliveryParams['mediaType']
): string {
  if (!mediaUrl) return html;
  if (mediaType === 'image') {
    return `${html}<br/><img src="${mediaUrl}" alt="" style="max-width:100%;" />`;
  }
  return `${html}<br/><a href="${mediaUrl}">View attachment</a>`;
}

export class EmailChannelProvider implements ChannelProvider {
  readonly channel = 'EMAIL' as const;
  readonly supportsMedia = true;

  // Real SendGrid API keys always start with "SG." — anything else (missing, blank, the
  // 'test_key' dev default) means no real SendGrid account is configured, so fall back to the
  // local Mailhog SMTP catcher (docker-compose's `mailhog` service, already used the same way
  // by report-service's ScheduledReportJob) instead of every email 401ing against the real API.
  private readonly smtpTransport: nodemailer.Transporter | null;

  constructor(
    private readonly apiKey: string,
    private readonly fromEmail: string,
    smtp?: { host: string; port: number; user: string; pass: string }
  ) {
    this.smtpTransport =
      !apiKey?.startsWith('SG.') && smtp
        ? nodemailer.createTransport({
            host: smtp.host,
            port: smtp.port,
            secure: false,
            auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
          })
        : null;
  }

  async send(params: ChannelDeliveryParams): Promise<ChannelDeliveryResult> {
    const to = params.email ?? '';
    if (!to) throw new Error('Email requires recipient address');

    const html = withMedia(params.body, params.mediaUrl, params.mediaType);
    const fromAddress = params.senderOverride?.addressOrNumber ?? this.fromEmail;
    const fromName = params.senderOverride?.name;

    if (this.smtpTransport) {
      const info = await this.smtpTransport.sendMail({
        from: fromName ? `"${fromName}" <${fromAddress}>` : fromAddress,
        to,
        subject: params.subject ?? 'Notification',
        html,
      });
      return { externalId: info.messageId };
    }

    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: fromAddress, ...(fromName ? { name: fromName } : {}) },
        subject: params.subject ?? 'Notification',
        content: [{ type: 'text/html', value: html }],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`SendGrid error: ${text}`);
    }

    const msgId = response.headers.get('X-Message-Id') ?? `email_${Date.now()}`;
    return { externalId: msgId };
  }
}
