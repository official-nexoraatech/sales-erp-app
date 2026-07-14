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

  constructor(
    private readonly apiKey: string,
    private readonly fromEmail: string
  ) {}

  async send(params: ChannelDeliveryParams): Promise<ChannelDeliveryResult> {
    const to = params.email ?? '';
    if (!to) throw new Error('Email requires recipient address');

    const html = withMedia(params.body, params.mediaUrl, params.mediaType);

    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: this.fromEmail },
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
