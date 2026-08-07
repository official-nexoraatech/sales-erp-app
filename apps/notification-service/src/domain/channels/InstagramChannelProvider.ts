import type { ChannelDeliveryParams, ChannelDeliveryResult, ChannelProvider } from './types.js';

// Instagram Messaging API (same Graph API family as WhatsAppChannelProvider, different resource
// path/payload shape — recipient.id keyed by IGSID rather than a phone number). `params.phone`
// carries the IGSID, per the overload documented on ChannelDeliveryParams.
function buildMessage(params: ChannelDeliveryParams, igsid: string): Record<string, unknown> {
  const recipient = { id: igsid };
  if (params.mediaUrl && params.mediaType === 'image') {
    return {
      recipient,
      message: { attachment: { type: 'image', payload: { url: params.mediaUrl } } },
    };
  }
  return { recipient, message: { text: params.body } };
}

export class InstagramChannelProvider implements ChannelProvider {
  readonly channel = 'INSTAGRAM' as const;
  readonly supportsMedia = true;

  constructor(
    private readonly businessAccountId: string,
    private readonly accessToken: string
  ) {}

  async send(params: ChannelDeliveryParams): Promise<ChannelDeliveryResult> {
    const igsid = params.phone ?? '';
    if (!igsid) throw new Error('Instagram requires a recipient IGSID');
    const url = `https://graph.facebook.com/v18.0/${this.businessAccountId}/messages`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildMessage(params, igsid)),
    });
    if (!response.ok) throw new Error(`Instagram API error: ${await response.text()}`);
    const data = (await response.json()) as { message_id?: string };
    return { externalId: data.message_id ?? `ig_${Date.now()}` };
  }
}
