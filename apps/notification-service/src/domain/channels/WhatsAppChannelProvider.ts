import type { ChannelDeliveryParams, ChannelDeliveryResult, ChannelProvider } from './types.js';

// Meta WhatsApp Cloud API media-message shape: { type: 'image'|'video'|'document', [type]: { link,
// caption } } instead of { type: 'text', text: { body } }. The body becomes the media's caption
// (image/video only — WhatsApp documents don't support captions in the same way, so the body is
// sent as a caption best-effort; if the API rejects it, the plain text path below still runs
// whenever no media is attached).
function buildMessage(params: ChannelDeliveryParams, phone: string): Record<string, unknown> {
  const base = { messaging_product: 'whatsapp', to: `91${phone}` };
  if (params.mediaUrl && params.mediaType) {
    const mediaField = params.mediaType === 'document' ? 'document' : params.mediaType;
    return {
      ...base,
      type: mediaField,
      [mediaField]: { link: params.mediaUrl, caption: params.body },
    };
  }
  return { ...base, type: 'text', text: { body: params.body } };
}

export class WhatsAppChannelProvider implements ChannelProvider {
  readonly channel = 'WHATSAPP' as const;
  readonly supportsMedia = true;

  constructor(
    private readonly phoneNumberId: string,
    private readonly accessToken: string
  ) {}

  async send(params: ChannelDeliveryParams): Promise<ChannelDeliveryResult> {
    const phone = params.phone ?? '';
    if (!phone) throw new Error('WhatsApp requires phone number');

    const url = `https://graph.facebook.com/v18.0/${this.phoneNumberId}/messages`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildMessage(params, phone)),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`WhatsApp API error: ${text}`);
    }

    const data = (await response.json()) as { messages?: Array<{ id: string }> };
    return { externalId: data.messages?.[0]?.id ?? `wa_${Date.now()}` };
  }
}
