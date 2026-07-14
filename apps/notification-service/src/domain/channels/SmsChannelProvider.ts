import type { ChannelDeliveryParams, ChannelDeliveryResult, ChannelProvider } from './types.js';

export class SmsChannelProvider implements ChannelProvider {
  readonly channel = 'SMS' as const;
  readonly supportsMedia = false;

  constructor(
    private readonly authKey: string,
    private readonly templateId: string
  ) {}

  async send(params: ChannelDeliveryParams): Promise<ChannelDeliveryResult> {
    const phone = params.phone ?? '';
    if (!phone) throw new Error('SMS requires phone number');

    const response = await fetch('https://api.msg91.com/api/v5/flow/', {
      method: 'POST',
      headers: {
        authkey: this.authKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        template_id: this.templateId,
        recipients: [{ mobiles: `91${phone}`, body: params.body }],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`MSG91 error: ${text}`);
    }

    const data = (await response.json()) as { request_id?: string };
    return { externalId: data.request_id ?? `sms_${Date.now()}` };
  }
}
