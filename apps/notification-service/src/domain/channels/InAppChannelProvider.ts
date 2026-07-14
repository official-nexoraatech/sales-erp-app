import { ulid } from 'ulid';
import type { ChannelDeliveryParams, ChannelDeliveryResult, ChannelProvider } from './types.js';

export class InAppChannelProvider implements ChannelProvider {
  readonly channel = 'IN_APP' as const;
  readonly supportsMedia = false;

  async send(_params: ChannelDeliveryParams): Promise<ChannelDeliveryResult> {
    // In-app delivery = notification already written to notification_log by the caller;
    // the SSE endpoint (GET /notifications/stream) pushes it live. Nothing to dispatch here.
    return { externalId: `inapp_${ulid()}` };
  }
}
