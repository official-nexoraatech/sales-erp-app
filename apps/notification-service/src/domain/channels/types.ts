// CP-2 (Campaign Management Platform initiative): channel-provider adapter interface.
// Extracted from what was inline logic in NotificationEngine.deliverViaChannel() — every
// existing channel (SMS/EMAIL/WHATSAPP/IN_APP) now implements this interface with no behavior
// change. Adding a new channel means implementing this interface and registering it in
// ChannelRegistry — CampaignService, SegmentService, and the campaign schema never change.
export type ChannelName = 'SMS' | 'EMAIL' | 'WHATSAPP' | 'IN_APP';

export interface ChannelDeliveryParams {
  phone?: string;
  email?: string;
  subject?: string;
  body: string;
  tenantId: number;
  /** Signed URL to a media asset (image/video/document) to attach, if the campaign has one. */
  mediaUrl?: string;
  mediaType?: 'image' | 'video' | 'document';
}

export interface ChannelDeliveryResult {
  /** Provider-assigned message id (used as notification_log.external_message_id). */
  externalId: string;
}

export interface ChannelProvider {
  readonly channel: ChannelName;
  /** Whether this channel can carry a media attachment alongside the text body. */
  readonly supportsMedia: boolean;
  send(params: ChannelDeliveryParams): Promise<ChannelDeliveryResult>;
}
